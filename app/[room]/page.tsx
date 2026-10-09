import { notFound } from "next/navigation";
import Home from "../page";

export default async function RoomPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  if (!["1", "2", "3"].includes(room)) notFound();
  return <Home />;
}
