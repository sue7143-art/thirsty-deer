// functions/api/nicepay-order.js
//
// 클라이언트가 카카오페이/네이버페이 버튼을 누르면 가장 먼저 호출하는 API.
// 가격(990원)과 이번에 열어줄 에피소드를 서버에서 확정해 pending_orders에
// 저장해두고, 나이스페이 결제창 호출에 필요한 orderId를 돌려줍니다.

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
    amount: WATER_PRICE,
    goodsName: "샘물 한 병 (에피소드 2편)",
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
