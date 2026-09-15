import { MinutesEditor } from "@/components/sales/minutes-editor"

export default async function Page({ params }: PageProps<"/sales/meetings/minutes/[id]">) {
  const { id } = await params
  return <MinutesEditor minutesId={id} />
}
