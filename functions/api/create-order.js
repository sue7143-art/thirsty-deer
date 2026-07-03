// functions/api/create-order.js
//
// 클라이언트가 카카오페이/네이버페이 버튼을 누르면 가장 먼저 이 API를 호출합니다.
// 번들(에피소드 묶음)과 가격을 "서버에서" 확정해서 pending_orders에 저장해두고,
// 결제가 끝난 뒤 toss-confirm.js가 이 값을 기준으로 검증합니다.
// (클라이언트에서 가격을 조작해 승인시키는 것을 막기 위함)

const BUNDLES = {
  bundle_02_03: {
    name: "아브라함의 믿음 + 야곱의 씨름",
    episodes: ["ep02", "ep03"],
    amount: 990,
  },
  bundle_04_05: {
    name: "요셉의 용서 + 기드온의 300용사",
    episodes: ["ep04", "ep05"],
    amount: 990,
  },
  bundle_06_07: {
    name: "모세와 금송아지 + 다윗과 사울",
    episodes: ["ep06", "ep07"],
    amount: 990,
  },
  bundle_08_09: {
    name: "엘리야와 로뎀나무 + 요나와 니느웨",
    episodes: ["ep08", "ep09"],
    amount: 990,
  },
  bundle_10: {
    name: "욥의 고난",
    episodes: ["ep10"],
    amount: 990,
  },
};

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { bundleId, userId } = body || {};
  const bundle = BUNDLES[bundleId];

  if (!bundle || !userId) {
    return json({ error: "invalid_request" }, 400);
  }

  const orderId = `${bundleId}-${String(userId).slice(0, 8)}-${Date.now()}`;

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
      bundle_id: bundleId,
      episodes: bundle.episodes,
      amount: bundle.amount,
    }),
  });

  if (!insertRes.ok) {
    const detail = await insertRes.text();
    return json({ error: "order_save_failed", detail }, 500);
  }

  return json({
    orderId,
    orderName: bundle.name,
    amount: bundle.amount,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
