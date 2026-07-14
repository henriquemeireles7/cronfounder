globalThis.fetch = async function xFixtureFetch(input, init = {}) {
  if (init.method === "GET" || !init.method) {
    if (init.headers?.authorization !== "Bearer bearer-token") {
      return Response.json({ title: "Unauthorized" }, { status: 401 });
    }
    return Response.json({
      data: {
        id: "x-post-123",
        public_metrics: {
          impression_count: 321,
          like_count: 12,
          retweet_count: 3,
          reply_count: 2,
          quote_count: 1,
          bookmark_count: 4,
        },
      },
    });
  }
  if (!init.headers?.authorization?.startsWith("OAuth ")) {
    return Response.json({ title: "Unauthorized" }, { status: 401 });
  }
  const { text } = JSON.parse(init.body);
  if (text.includes("[uncertain]")) throw new TypeError("socket closed after request write");
  if (text.includes("[duplicate]")) {
    return Response.json({ detail: "You are not allowed to create a Tweet with duplicate content." }, { status: 403 });
  }
  if (text.includes("[unauthorized]")) return Response.json({ title: "Unauthorized" }, { status: 401 });
  return Response.json({ data: { id: "x-post-123", text } }, { status: 201 });
};
