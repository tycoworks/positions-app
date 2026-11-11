// Data layer for tycostream's GraphQL subscriptions, which arrive over server-sent events. Each message
// is one timestamp's updates, the first the snapshot. Each update carries an operation (INSERT, UPDATE
// or DELETE), the row's data, and the fields it sends: an UPDATE sends the row's key and the changed
// fields only, and every other field selected comes as null. A list's updates come beside the data, in
// their parent's update.
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

// Subscribes to a source, calling onUpdates with each message's updates. The cache stays out of it:
// an update's data is partial, and merging its nulls into cached rows would overwrite them.
export function subscribe(source, query, onUpdates) {
  return client.subscribe({ query, fetchPolicy: 'no-cache' }).subscribe(({ data }) => {
    const updates = data?.[source];
    if (updates) onUpdates(updates);
  });
}
