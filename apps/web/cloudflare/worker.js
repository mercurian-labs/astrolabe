// Cloudflare runs this only for requests that match no file in dist/. A client route such as /pair
// gets the app shell. A missing hashed bundle (an open tab asking for a chunk a release replaced)
// gets a 404: a single-page-application fallback would answer it with index.html under the
// bundle's year-long immutable Cache-Control from _headers.
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/assets/")) {
      return new Response("Not found", { status: 404 });
    }
    return env.ASSETS.fetch(new Request(new URL("/", url), request));
  },
};
