// Netlify Edge Function: durable PDF archive backed by Netlify Blobs.
// Route: /doc/:id  ->  serves the archived copy of a library PDF.
//
// How it works:
//   1. If the PDF is already in the Blobs store, stream it from there.
//   2. If not, fetch it from its canonical source ONCE, store it in Blobs,
//      then serve it. Every later request is served from our own copy — so
//      if the source link ever changes or dies, the document still opens.
//   3. If Blobs is unavailable or the source fetch fails, fall back to a
//      redirect to the source so the link never breaks.
//
// SOURCES is a fixed whitelist (id -> URL). The function only ever fetches
// these exact URLs, so it can't be used as an open proxy.
import { getStore } from "@netlify/blobs";

const SOURCES = {
  "s-td-rxcx": "https://media.rinnai.us/salsify_asset/s-4c213567-ddfa-42b1-ae72-8daaf587961d/100000849-SENSEI%20RX%20CX%20Tech%20Sheet_English.pdf",
  "s-td-rsc": "https://media.rinnai.us/salsify_asset/s-906e84f5-92ba-46dd-9619-0dbcc130ae89/100000786-SENSEI%20Tech%20Sheet-RSC.pdf",
  "s-td-rur": "https://media.rinnai.us/salsify_asset/s-f3d0e42b-79ae-4232-8be9-f4b73d239324/U334-0783X01(01)-100000507(01)-N-Series%20Techsheet-Res%20with%20Pump.pdf",
  "s-td-ru": "https://media.rinnai.us/salsify_asset/s-75390343-35ca-405e-aa2c-bb81667f7062/U334-0781X01(01)-100000505(01)-N-Series%20Techsheet-Res%20and%20Comm.pdf",
  "s-sp-rx": "https://media.rinnai.us/salsify_asset/s-b65161ac-3923-46b2-b2e6-65adc57fea27/100000883%20SENSEI%20RX%20Residential%20Condensing%20Spec%20Sheet.pdf",
  "s-sp-rei": "https://media.rinnai.us/salsify_asset/s-15b74aa5-ad50-4bca-8472-3ad046ca968d/REi-SP%20Non%20Condensing%20Residential%20Indoor%20Spec%20Sheet.pdf",
  "s-sp-ree": "https://media.rinnai.us/salsify_asset/s-cbd9a57a-b865-4b48-bbbc-66247d74df96/REe-SP%20Non%20Condensing%20Residential%20Outdoor%20Spec%20Sheet.pdf",
  "s-sp-rsci": "https://media.rinnai.us/salsify_asset/s-810e92fc-9d0d-4208-b914-8b37d43dd34a/RSCi-SP-2%20SENSEI%20Condensing%20with%20Pump%20Indoor%20Spec%20Sheet.pdf",
  "s-sp-rsce": "https://media.rinnai.us/salsify_asset/s-2344b632-68ba-4a7a-9c13-a6dc231cb5d9/RSCe-SP-1%20SENSEI%20Condensing%20with%20Pump%20Outdoor%20Spec%20Sheet.pdf",
  "s-sp-rur": "https://media.rinnai.us/salsify_asset/s-9896fa18-b5c1-4fee-b1c1-5054c834acc0/RURi-SP-N%20Series%20Condensing%20Residential%20with%20Pump%20Indoor%20Spec%20Sheet.pdf",
  "s-sp-rui": "https://media.rinnai.us/salsify_asset/s-256984e6-5151-41e4-a0c0-fc6c392ff0f7/RUi-SP-4%20SENSEI%20Condensing%20Residential%20Indoor%20Spec%20Sheet.pdf",
  "s-sp-rue": "https://media.rinnai.us/salsify_asset/s-ae254def-662a-4241-ac5c-3cdf1ea2fee0/RUe-SP-4%20SENSEI%20Condensing%20Residential%20Outdoor%20Spec%20Sheet.pdf",
  "s-rx-man": "https://images.thdstatic.com/catalog/pdfImages/00/00747a6c-ef07-42a7-814a-244d8b5b8349.pdf",
  "s-re-man": "https://media.rinnai.us/salsify_asset/s-4c0f42d2-4a9d-40d2-a189-d4f84bee5509/100000722(02)%20RE%20Installation%20and%20Operation%20Manual.pdf",
  "s-vent": "https://media.rinnai.us/salsify_asset/s-7bbd9e1e-b3de-4800-acad-aa997c5e9f28/100000625-PVC%20and%20CPVC%20Common%20Venting%20Installation%20Instructions%20for%20SENSEI.pdf",
  "s-duo2": "https://media.rinnai.us/salsify_asset/s-eab7351b-b8a4-43d2-a1ab-3043b0b802d8/100000872%20Demand%20Duo%202%20H-Series%20with%20SENSEI%20CX%20Installation%20Instructions.pdf",
  "s-trs": "https://media.rinnai.us/salsify_asset/s-b1e7e822-5e97-4bb3-98b9-7e763342cd0e/100000870%20TRS%20with%20SENSEI%20CX%20Installation%20Instructions.pdf",
  "s-rep-man": "https://media.rinnai.us/salsify_asset/s-082a23e8-a027-49c5-9103-30d64d02f381/100000726(03)%20REP%20Installation%20and%20Operation%20Manual.pdf",
  "s-rsc-man": "https://media.rinnai.us/salsify_asset/s-815d8447-6141-4ddc-b1c1-6464d5c23d50/100000773-RSC%20SENSEI%20Installation%20and%20Operation%20Manual.pdf",
  "s-cx-man": "https://media.rinnai.us/salsify_asset/s-c0fcb742-0456-4168-82cf-9373b43514cd/100000840%20SENSEI%20CX%20Commercial%20Installation%20and%20Operation%20Manual.pdf",
  "s-ru-man": "https://media.rinnai.us/salsify_asset/s-bb57a000-5f48-4159-ac3c-47e47f8180f7/100000467-N%20Series%20Residential%20Condensing%20Installation%20and%20Operation%20Manual.pdf",
  "s-rur-man": "https://media.rinnai.us/salsify_asset/s-286a4b4b-e04a-4af4-9ee4-4311495ae923/100000508-N%20Series%20Residential%20with%20Pump%20Condensing%20Installation%20and%20Operation%20Manual.pdf",
  "s-cu-man": "https://media.rinnai.us/salsify_asset/s-0dbc4660-4b6d-4210-82c7-a7ed6834a355/100000504-N%20Series%20Commercial%20Condensing%20Installation%20and%20Operation%20Manual.pdf",
  "s-value-man": "https://media.rinnai.us/salsify_asset/s-43d60415-4de7-4ad8-aa59-1b39248bfe09/100000258-Value%20Series%20Installation%20and%20Operation%20Manual.pdf",
  "s-rack-man": "https://media.rinnai.us/salsify_asset/s-a823682c-30b6-412b-977a-1f92b8ab594b/100000294-Tankless%20Rack%20Installation%20Manual.pdf",
  "s-rx-bro": "https://media.rinnai.us/salsify_asset/s-1fd1afd2-d37d-433b-8cea-7505e7a8452d/2023162.SENSEI%20RX%20Series.Brochure.US.pdf",
  "s-duo-bro": "https://www.rinnai.us/sites/default/files/2024-11/US%20-%20Demand%20Duo%C2%AE%20Hybrid%20Commercial%20Water%20Heating%20Solutions%20(1).pdf",
  "s-re-bro": "https://media.rinnai.us/salsify_asset/s-fb61be47-e43f-4d37-97ae-063d9484f8d0/2021069.A-RE%E2%80%A2Series%20Broc.v8.pdf",
  "s-td-rei": "https://media.rinnai.us/salsify_asset/s-08d78ab4-23e4-4fc0-8ec4-753c17a25d05/100000733%20VE%20Non-Pump%20Indoor%20Tech%20Sheet.pdf",
  "s-td-re": "https://media.rinnai.us/salsify_asset/s-f7e95f26-90e9-45bf-8188-52b154268d00/100000735%20VE%20Non-Pump%20Outdoor%20Tech%20Sheet.pdf",
  "s-td-repi": "https://media.rinnai.us/salsify_asset/s-ca686d95-9adf-415a-a2a2-1ea1d9b09c8c/100000734%20VE%20Pump%20Indoor%20Tech%20Sheet.pdf",
  "s-td-repe": "https://media.rinnai.us/salsify_asset/s-6b3de262-fd19-405d-80cd-f394658596a5/100000736%20VE%20Pump%20Outdoor%20Tech%20Sheet.pdf",
  "s-rehp-bro": "https://media.rinnai.us/salsify_asset/s-c823302d-d490-43dd-8020-bcc3402445ad/US%20Rinnai%20Electric%20Heat%20Pump%20(REHP)%20Brochure.pdf",
  "s-comm-bro": "https://www.rinnai.us/sites/default/files/2024-11/US%20Commercial%20Water%20Heating%20Solutions%20brochure.pdf",
  "s-codes-full": "https://images.salsify.com/image/upload/s--Xfn54DOw--/chm21orqxqwes8akeb9b.pdf",
  "s-tb111": "https://media.rinnai.us/salsify_asset/s-f905168b-b0a9-4b7c-a205-bbb8071597bb/TB-111%20Half%20Inch%20Gas%20line.pdf"
};

const pdfHeaders = (id, state) => ({
  "content-type": "application/pdf",
  "content-disposition": `inline; filename="${id}.pdf"`,
  "cache-control": "public, max-age=86400",
  "x-archive": state,
});

export default async (request) => {
  const id = new URL(request.url).pathname.split("/").filter(Boolean).pop();
  const source = SOURCES[id];
  if (!source) return new Response("Unknown document id", { status: 404 });

  try {
    const store = getStore("pdf-archive");

    // Already captured -> serve our durable copy.
    const archived = await store.get(id, { type: "stream" });
    if (archived) return new Response(archived, { headers: pdfHeaders(id, "hit") });

    // First access -> capture from source, store, serve.
    const res = await fetch(source, {
      headers: { "user-agent": "Mozilla/5.0 (RinnaiWorkLibrary archiver)" },
    });
    if (!res.ok) throw new Error(`source ${res.status}`);
    const buf = await res.arrayBuffer();
    await store.set(id, buf, {
      metadata: { source, capturedAt: new Date().toISOString(), bytes: buf.byteLength },
    });
    return new Response(buf, { headers: pdfHeaders(id, "captured") });
  } catch (err) {
    // Never break the link: send the visitor straight to the source.
    return Response.redirect(source, 302);
  }
};

export const config = { path: "/doc/*" };
