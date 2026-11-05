import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AdminSidebarLayout } from "@/components/admin-sidebar-layout";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  return (
    <AdminSidebarLayout user={{ name: session.name, email: session.email, role: session.role }}>
      {children}
    </AdminSidebarLayout>
  );
}
