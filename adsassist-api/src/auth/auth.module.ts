import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Throttle } from '@nestjs/throttler';
import bcrypt from 'bcryptjs';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Model } from 'mongoose';
import { CurrentUser, Public, type AuthUser } from '../common/auth/decorators.js';
import { User, UserDoc } from '../database/schemas/workspace.schema.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';

class RegisterDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}

class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() currentPassword?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(200) newPassword?: string;
}

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 12);

export const publicUser =(u: UserDoc) => ({ id: u.id as string, name: u.name, email: u.email, createdAt: u.createdAt });

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly jwt: JwtService,
  ) {}

  private token(u: UserDoc) {
    return this.jwt.signAsync({ sub: u.id, email: u.email });
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    if (await this.users.exists({ email })) throw new ConflictException('An account with this email already exists');
    const user = await this.users.create({ name: dto.name.trim(), email, passwordHash: await bcrypt.hash(dto.password, 12) });
    return { accessToken: await this.token(user), user: publicUser(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({ email: dto.email.toLowerCase().trim() }).select('+passwordHash');
    // Compare against a dummy hash when the user is missing so timing doesn't reveal which emails exist.
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    user.lastLoginAt = new Date();
    await user.save();
    return { accessToken: await this.token(user), user: publicUser(user) };
  }

  async update(userId: string, dto: UpdateMeDto) {
    const user = await this.users.findById(userId).select('+passwordHash');
    if (!user) throw new UnauthorizedException();
    if (dto.name) user.name = dto.name.trim();
    if (dto.newPassword) {
      if (!dto.currentPassword || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
        throw new UnauthorizedException('Current password is incorrect');
      }
      user.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    }
    await user.save();
    return { user: publicUser(user) };
  }

  async findById(id: string) {
    const user = await this.users.findById(id);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.auth.findById(u.id);
    return { user: publicUser(user), workspaces: await this.workspaces.listForUser(u.id) };
  }

  @Patch('me')
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) {
    return this.auth.update(u.id, dto);
  }
}

@Module({
  imports: [WorkspacesModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
