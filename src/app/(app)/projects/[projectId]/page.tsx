import { redirect } from 'next/navigation';

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/** A project opens on its Summary. */
export default async function ProjectIndexPage({ params }: PageProps) {
  const { projectId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}/summary`);
}
