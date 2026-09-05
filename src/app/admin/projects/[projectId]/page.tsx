import { getProjectById } from '@/actions/projects';
import ProjectDetailContent from './content';

interface Props {
  params: {
    projectId: string;
  };
}

export default async function ProjectDetailPage({ params }: Props) {
  const project = await getProjectById(params.projectId);

  return <ProjectDetailContent project={project} />;
}
