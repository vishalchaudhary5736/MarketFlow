// The Prisma 7 `prisma-client` generator emits TypeScript whose internal
// imports carry `.js` extensions (ESM style). TypeScript resolves those to the
// neighbouring `.ts` files automatically; webpack does not, so it needs the
// same mapping spelled out or the build fails with
// "Can't resolve './enums.js' in generated/prisma".
module.exports = (options) => ({
  ...options,
  resolve: {
    ...options.resolve,
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
});
