import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { decryptToken, encryptToken } from '../common/crypto/token-crypto.js';
import {
  AdAccount,
  AdAccountDoc,
  Platform,
  PlatformConnection,
  PlatformConnectionDoc,
} from '../database/schemas/integration.schema.js';
import { GoogleAdsClient } from './platforms/google-ads.client.js';
import { PlatformError } from './platforms/http.js';
import { MetaClient } from './platforms/meta.client.js';

interface OAuthState {
  wid: string;
  uid: string;
  p: Platform;
  n: string;
}

/** Owns OAuth grants: connect/callback, token refresh, revocation, account discovery. */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    @InjectModel(PlatformConnection.name) private readonly connections: Model<PlatformConnection>,
    @InjectModel(AdAccount.name) private readonly adAccounts: Model<AdAccount>,
    private readonly google: GoogleAdsClient,
    private readonly meta: MetaClient,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async connectUrl(workspaceId: string, userId: string, platform: Platform) {
    const client = platform === 'google' ? this.google : this.meta;
    if (!client.configured) {
      throw new ServiceUnavailableException(
        platform === 'google'
          ? 'Google Ads is not configured (GOOGLE_ADS_CLIENT_ID / SECRET / DEVELOPER_TOKEN)'
          : 'Meta is not configured (META_APP_ID / META_APP_SECRET)',
      );
    }
    const state = await this.jwt.signAsync(
      { wid: workspaceId, uid: userId, p: platform, n: randomBytes(8).toString('hex') } satisfies OAuthState,
      { expiresIn: '15m' },
    );
    return { url: client.authUrl(state) };
  }

  /** Handles the platform redirect and returns the web URL to send the browser to. */
  async handleCallback(platform: Platform, query: Record<string, string | undefined>): Promise<string> {
    const web = this.config.get<string>('WEB_URL');
    let state: OAuthState;
    try {
      state = await this.jwt.verifyAsync<OAuthState>(query.state ?? '');
      if (state.p !== platform) throw new Error('platform mismatch');
    } catch {
      return `${web}/?error=${encodeURIComponent('OAuth session expired. Please try connecting again.')}`;
    }
    const back = (params: Record<string, string>) => `${web}/w/${state.wid}/integrations?${new URLSearchParams(params)}`;
    if (query.error || !query.code) {
      return back({ error: query.error_description ?? query.error_message ?? query.error ?? 'Authorization was cancelled' });
    }
    try {
      const conn = platform === 'google' ? await this.finishGoogle(state, query.code) : await this.finishMeta(state, query.code);
      return back({ connected: platform, connectionId: conn.id });
    } catch (e) {
      this.logger.error(`${platform} OAuth callback failed: ${(e as Error).message}`);
      return back({ error: (e as Error).message });
    }
  }

  private async upsertConnection(state: OAuthState, platform: Platform, data: Partial<PlatformConnection>) {
    const filter = {
      workspaceId: new Types.ObjectId(state.wid),
      platform,
      externalUserId: data.externalUserId ?? '',
    };
    const existing = await this.connections.findOne(filter).select('+refreshTokenEnc');
    if (platform === 'google' && !data.refreshTokenEnc && !existing?.refreshTokenEnc) {
      throw new BadRequestException(
        'Google did not return a refresh token. Remove this app at https://myaccount.google.com/permissions and connect again.',
      );
    }
    // Google omits the refresh token when the app was already authorised; keep the old one.
    if (!data.refreshTokenEnc) delete data.refreshTokenEnc;
    const conn = await this.connections.findOneAndUpdate(
      filter,
      { $set: { ...data, status: 'active', lastError: null, connectedBy: new Types.ObjectId(state.uid) } },
      { upsert: true, returnDocument: 'after' },
    );
    // Re-activate ad accounts that were in error because of the old grant.
    await this.adAccounts.updateMany({ connectionId: conn._id, status: 'error' }, { status: 'active', lastSyncError: null });
    return conn;
  }

  private async finishGoogle(state: OAuthState, code: string) {
    const tokens = await this.google.exchangeCode(code);
    const [info, accounts] = await Promise.all([
      this.google.userInfo(tokens.accessToken),
      this.google.discoverAccounts(tokens.accessToken),
    ]);
    return this.upsertConnection(state, 'google', {
      externalUserId: info.id,
      externalUserName: info.name,
      externalUserEmail: info.email,
      accessTokenEnc: encryptToken(tokens.accessToken),
      refreshTokenEnc: encryptToken(tokens.refreshToken),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      scopes: tokens.scope.split(' ').filter(Boolean),
      availableAccounts: accounts,
    });
  }

  private async finishMeta(state: OAuthState, code: string) {
    const token = await this.meta.exchangeCode(code);
    const [me, accounts] = await Promise.all([this.meta.me(token.accessToken), this.meta.discoverAccounts(token.accessToken)]);
    return this.upsertConnection(state, 'meta', {
      externalUserId: me.id,
      externalUserName: me.name ?? '',
      externalUserEmail: me.email ?? '',
      accessTokenEnc: encryptToken(token.accessToken),
      accessTokenExpiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null,
      availableAccounts: accounts,
    });
  }

  private async load(connectionId: Types.ObjectId | string) {
    const conn = await this.connections.findById(connectionId).select('+accessTokenEnc +refreshTokenEnc');
    if (!conn) throw new NotFoundException('Connection not found');
    return conn;
  }

  /**
   * A valid access token for API calls. Google tokens are refreshed a minute
   * before expiry. A revoked grant marks the connection and its accounts as
   * errored so the UI can ask the user to reconnect.
   */
  async accessToken(connectionId: Types.ObjectId | string): Promise<string> {
    const conn = await this.load(connectionId);
    if (conn.status === 'revoked') throw new PlatformError('This connection was disconnected. Reconnect it.', 401, true);
    try {
      if (conn.platform === 'meta') {
        if (conn.accessTokenExpiresAt && conn.accessTokenExpiresAt < new Date()) {
          throw new PlatformError('Meta access expired (60-day limit). Reconnect Meta.', 401, true);
        }
        return decryptToken(conn.accessTokenEnc);
      }
      if (conn.accessTokenEnc && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
        return decryptToken(conn.accessTokenEnc);
      }
      const fresh = await this.google.refresh(decryptToken(conn.refreshTokenEnc));
      await this.connections.updateOne(
        { _id: conn._id },
        { accessTokenEnc: encryptToken(fresh.accessToken), accessTokenExpiresAt: new Date(Date.now() + fresh.expiresIn * 1000), status: 'active', lastError: null },
      );
      return fresh.accessToken;
    } catch (e) {
      if (e instanceof PlatformError && e.authRevoked) await this.markRevoked(conn, e.message);
      throw e;
    }
  }

  async markRevoked(conn: PlatformConnectionDoc | Types.ObjectId, message: string) {
    const id = conn instanceof Types.ObjectId ? conn : conn._id;
    await this.connections.updateOne({ _id: id }, { status: 'error', lastError: message });
    await this.adAccounts.updateMany({ connectionId: id }, { status: 'error', lastSyncError: message });
  }

  async list(workspaceId: Types.ObjectId) {
    const [conns, accounts] = await Promise.all([
      this.connections.find({ workspaceId, status: { $ne: 'revoked' } }).sort({ createdAt: -1 }),
      this.adAccounts.find({ workspaceId }, { connectionId: 1, externalId: 1 }),
    ]);
    return conns.map((c) => this.view(c, accounts));
  }

  private view(c: PlatformConnectionDoc, accounts: Pick<AdAccountDoc, 'connectionId' | 'externalId'>[]) {
    const selected = new Set(accounts.filter((a) => a.connectionId.equals(c._id)).map((a) => a.externalId));
    return {
      id: c.id as string,
      platform: c.platform,
      externalUserName: c.externalUserName,
      externalUserEmail: c.externalUserEmail,
      status: c.status,
      lastError: c.lastError,
      createdAt: c.createdAt,
      availableAccounts: c.availableAccounts.map((a) => ({
        externalId: a.externalId,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        isManager: a.isManager,
        selected: selected.has(a.externalId),
      })),
    };
  }

  async get(workspaceId: Types.ObjectId, id: string) {
    const conn = await this.connections.findOne({ _id: id, workspaceId });
    if (!conn) throw new NotFoundException('Connection not found');
    return conn;
  }

  async refreshAccounts(workspaceId: Types.ObjectId, id: string) {
    const conn = await this.get(workspaceId, id);
    const token = await this.accessToken(conn._id);
    conn.availableAccounts = conn.platform === 'google' ? await this.google.discoverAccounts(token) : await this.meta.discoverAccounts(token);
    await conn.save();
    const accounts = await this.adAccounts.find({ workspaceId }, { connectionId: 1, externalId: 1 });
    return this.view(conn, accounts);
  }

  async remove(workspaceId: Types.ObjectId, id: string) {
    const conn = await this.get(workspaceId, id);
    try {
      const full = await this.load(conn._id);
      if (full.platform === 'google' && full.refreshTokenEnc) await this.google.revoke(decryptToken(full.refreshTokenEnc));
      if (full.platform === 'meta' && full.accessTokenEnc) await this.meta.revoke(decryptToken(full.accessTokenEnc));
    } catch (e) {
      this.logger.warn(`Token revoke failed: ${(e as Error).message}`);
    }
    await this.connections.updateOne({ _id: conn._id }, { status: 'revoked', accessTokenEnc: '', refreshTokenEnc: '' });
    await this.adAccounts.updateMany({ connectionId: conn._id }, { status: 'disconnected', syncEnabled: false });
    return { ok: true };
  }
}
