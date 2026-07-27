import { DraftRoom } from "@/features/draft-room/components/draft-room";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  return <DraftRoom draftId={draftId} />;
}
