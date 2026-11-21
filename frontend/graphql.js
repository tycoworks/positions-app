// Data layer for tycostream's GraphQL subscriptions, which arrive over server-sent events. Each message
// is one timestamp's updates, the first the snapshot. Each update carries an operation (INSERT, UPDATE
// or DELETE), the row's key, and the row's data: the whole row for an INSERT and for an UPDATE of a row
// that changed, and null for a DELETE and for an UPDATE where only a list changed. A list's updates come
// beside the data, in their parent's update.
import { ApolloClient, InMemoryCache } from '@apollo/client/core';
import { YogaLink } from '@graphql-yoga/apollo-link';
export { gql } from '@apollo/client/core';

const TYCOSTREAM_URL = import.meta.env.VITE_TYCOSTREAM_URL ?? 'http://localhost:4000/graphql';

// The operations an update carries, tycostream's row_operation
export const Operation = Object.freeze({ Insert: 'INSERT', Update: 'UPDATE', Delete: 'DELETE' });

const client = new ApolloClient({
  link: new YogaLink({ endpoint: TYCOSTREAM_URL }),
  cache: new InMemoryCache(),
});

// Subscribes to a source with the query's variables, calling onUpdates with each message's updates. An
// error arrives in a result too, and is logged. The cache stays out of it, since the grids hold the rows and nothing reads it.
export function subscribe(source, query, variables, onUpdates) {
  return client.subscribe({ query, variables, fetchPolicy: 'no-cache' }).subscribe(({ data, error }) => {
    if (error) console.error('Subscription error:', error);
    const updates = data?.[source];
    if (updates) onUpdates(updates);
  });
}
