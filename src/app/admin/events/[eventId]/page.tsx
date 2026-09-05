import { getAllProducts } from '@/actions/products';
import { getEventById } from '@/actions/events';
import EventDetailContent from './content';

interface Props {
  params: {
    eventId: string;
  };
}

export default async function EventDetailPage({ params }: Props) {
  const event = await getEventById(params.eventId);
  const products = await getAllProducts();

  return <EventDetailContent event={event} products={products} />;
}
