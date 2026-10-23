// Side-effect stylesheet imports and asset URLs, which Vite bundles.
declare module "*.css";
declare module "*?url" {
  const url: string;
  export default url;
}
