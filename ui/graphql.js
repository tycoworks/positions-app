// Data layer for tycostream's GraphQL subscriptions, which arrive over server-sent events. Each event
// is one timestamp's updates, the first the snapshot. Each update carries an operation (INSERT,
// UPDATE or DELETE), the row's data, and the fields it sends: an UPDATE sends the row's key and the
// changed fields only.
import { ApolloClient, InMemoryCache, gql } from '@apollo/client/core';
import { YogaLink } from '@graphql-yoga/apollo-link';

const TYCOSTREAM_URL = import.meta.env.VITE_TYCOSTREAM_URL ?? 'http://localhost:4000/graphql';

const client = new ApolloClient({
  link: new YogaLink({ endpoint: TYCOSTREAM_URL }),
  cache: new InMemoryCache(),
});

// where is an optional filter in tycostream's Hasura-style format, e.g. { instrument_id: { _eq: 1 } }
export function subscribe(source, fields, onUpdates, where) {
  const query = gql`subscription ($where: ${source}_bool_exp) {
    ${source}(where: $where) { operation data { ${fields.join(' ')} } fields }
  }`;
  return client.subscribe({ query, variables: { where }, fetchPolicy: 'no-cache' }).subscribe(({ data }) => {
    const updates = data?.[source];
    if (updates) onUpdates(updates);
  });
}
