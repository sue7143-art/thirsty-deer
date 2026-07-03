// functions/api/create-order.js
//
// 클라이언트가 카카오페이/네이버페이 버튼을 누르면 가장 먼저 이 API를 호출합니다.
// 샘물은 항상 990원 = 크레딧 2개(고정 상품)입니다. 어떤 에피소드를 결제 직후
// 즉시 열어줄지(episodeId)만 클라이언트가 알려주고, 가격은 서버에서 고정합니다.

const WATER_PRICE = 990;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { episodeId, userId } = body || {};

  if (!episodeId || !userId) {
    return json({ error: "invalid_request" }, 400);
  }

  const orderId = `water-${String(userId).slice(0, 8)}-${Date.now()}`;

  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/pending_orders`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      order_id: orderId,
      user_id: userId,
      episode_id: episodeId,
      amount: WATER_PRICE,
    }),
  });

  if (!insertRes.ok) {
    const detail = await insertRes.text();
    return json({ error: "order_save_failed", detail }, 500);
  }

  return json({
    orderId,
    orderName: "샘물 한 병 (에피소드 2편)",
    amount: WATER_PRICE,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
