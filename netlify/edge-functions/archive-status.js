// Netlify Edge Function: report what the PDF archive currently holds.
// Open /archive-status in a browser to see how many documents are captured.
import { getStore } from "@netlify/blobs";

export default async () => {
  try {
    const store = getStore("pdf-archive");
    const { blobs } = await store.list();
    const archived = blobs.map((b) => b.key).sort();
    return Response.json(
      { count: archived.length, archived },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
};
