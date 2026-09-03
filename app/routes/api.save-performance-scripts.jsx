import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  try {
    const body = await request.json();
    const { auditScript, deferScript, hiddenCss } = body;

    // 1. Get store record by shop domain
    const store = await prisma.store.findUnique({
      where: { shopDomain: session.shop },
    });

    if (!store) {
      return new Response(
        JSON.stringify({ success: false, error: "Store record not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Upsert script record by storeId
    const record = await prisma.performanceScript.upsert({
      where: { storeId: store.id },
      update: {
        auditScript: auditScript || "",
        deferScript: deferScript || "",
        hiddenCss: hiddenCss || "",
      },
      create: {
        storeId: store.id,
        auditScript: auditScript || "",
        deferScript: deferScript || "",
        hiddenCss: hiddenCss || "",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Performance scripts saved successfully!",
        data: record,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Save Performance Scripts Error]:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
