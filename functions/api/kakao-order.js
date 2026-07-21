// functions/api/kakao-order.js
//
// 카카오페이 결제 준비(ready) API를 서버에서 호출합니다.
// (2024년부터 open-api.kakaopay.com + SECRET_KEY 인증 방식으로 변경됨)
// 결제창 주소(redirectUrl)를 받아서 클라이언트에 돌려주고,
// 승인 단계에서 필요한 tid를 주문 정보와 함께 저장해둡니다.
//
// isGift가 true면 특정 에피소드가 아니라 "선물 코드" 발급용 주문이에요.

const WATER_PRICE = 990;

// 카카오페이 결제창에 표시할 에피소드 제목
// (선물 상품명에 사용 — "크레딧 선물"이 아니라 "콘텐츠 선물"임을 명확히 하기 위함)
const EPISODE_TITLES = {
  ep02: "아브라함의 믿음",
  ep03: "야곱의 씨름",
  ep04: "요셉의 용서",
  ep05: "기드온의 300용사",
  ep06: "모세와 금송아지",
  ep07: "다윗과 사울",
  ep08: "엘리야와 로뎀나무",
  ep09: "요나와 니느웨",
  ep10: "욥의 고난",
};

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { episodeId, userId, isGift, message, senderName } = body || {};

  // 선물이어도 이제는 특정 에피소드를 반드시 지정해야 해요.
  // (카카오페이: 크레딧처럼 범용으로 쓸 수 있는 선물은 불가, 특정 콘텐츠 선물만 허용)
  if (!userId || !episodeId) {
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
      item_name: isGift
        ? `${EPISODE_TITLES[episodeId] || "성경 이야기"} 선물하기`
        : "샘물 한 병 (에피소드 2편)",
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
      episode_id: episodeId,
      amount: WATER_PRICE,
      tid,
      is_gift: !!isGift,
      message: isGift ? (message || null) : null,
      sender_name: isGift ? (senderName || null) : null,
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
