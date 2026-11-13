import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import ToolPage from "@/components/tool-page";

export default async function AppPage() {
  const session = await auth();
  if (!session?.accessToken || session.error) {
    redirect("/");
  }

  return (
    <ToolPage
      userName={session.user?.name ?? "You"}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    />
  );
}
