import Messenger from '../messenger';

export default function ConversationPage({
  conversationId,
}: {
  conversationId: string;
}) {
  return <Messenger conversationId={conversationId} />;
}
