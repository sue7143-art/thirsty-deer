// functions/api/kakao-order.js
//
// 카카오페이 결제 준비(ready) API를 서버에서 호출합니다.
// (2024년부터 open-api.kakaopay.com + SECRET_KEY 인증 방식으로 변경됨)
// 결제창 주소(redirectUrl)를 받아서 클라이언트에 돌려주고,
// 승인 단계에서 필요한 tid를 주문 정보와 함께 저장해둡니다.
//
// isGift가 true면 특정 에피소드가 아니라 "선물 코드" 발급용 주문이에요.

const WATER_PRICE = 990;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { episodeId, userId, isGift, message } = body || {};
  if (!userId || (!isGift && !episodeId)) {
    return json({ error: "invalid_request" }, 400);
  }

  const orderId = `water-${String(userId).slice(0, 8)}-${Date.now()}`;
  const origin = new URL(request.url).origin;

  // 테스트 CID는 심사 승인 전에도 바로 사용 가능해요.
  // 실 서비스 전환 시 카카오페이 파트너센터에서 발급받은 실 CID로 교체하세요.
  const cid = env.KAKAO_CID || "TC0ONETIME";

  const readyRes = await fetch("https://open-api.kakaopay.com/online/v1/payment/ready", {
    method: "POST",
    headers: {
      Authorization: `SECRET_KEY ${env.KAKAO_PAY_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cid,
      partner_order_id: orderId,
      partner_user_id: String(userId),
      item_name: isGift ? "샘물 선물하기" : "샘물 한 병 (에피소드 2편)",
      quantity: 1,
      total_amount: WATER_PRICE,
      tax_free_amount: 0,
      approval_url: `${origin}/api/kakao-approve?orderId=${orderId}`,
      cancel_url: `${origin}/?payment=fail&reason=cancelled`,
      fail_url: `${origin}/?payment=fail&reason=kakao_fail`,
    }),
  });

  if (!readyRes.ok) {
    const detail = await readyRes.text();
    return json({ error: "kakao_ready_failed", detail: detail.slice(0, 300) }, 500);
  }

  const readyData = await readyRes.json();
  const tid = readyData.tid;
  const redirectUrl = readyData.next_redirect_mobile_url || readyData.next_redirect_pc_url;

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
      episode_id: isGift ? null : episodeId,
      amount: WATER_PRICE,
      tid,
      is_gift: !!isGift,
      message: isGift ? (message || null) : null,
    }),
  });

  if (!insertRes.ok) {
    const detail = await insertRes.text();
    return json({ error: "order_save_failed", detail: detail.slice(0, 300) }, 500);
  }

  return json({ redirectUrl });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
