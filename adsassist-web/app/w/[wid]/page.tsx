import { redirect } from "next/navigation"

export default async function WorkspaceIndex({ params }: PageProps<"/w/[wid]">) {
  const { wid } = await params
  redirect(`/w/${wid}/dashboard`)
}
