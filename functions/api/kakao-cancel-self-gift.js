// functions/api/kakao-cancel-self-gift.js
//
// 본인이 자신에게 보낸 선물을 열었을 때(self_redeem) 호출됩니다.
//
// ⚠️ 신원 확인은 여기서 하지 않습니다.
// 프론트에서 먼저 Supabase RPC `mark_gift_cancelled_by_sender`를 호출해서
// (redeem_gift와 동일한 auth.uid() 기반 검증으로) 본인 확인 + 코드를
// 'cancelled' 상태로 표시해두고, 이 함수는 그 상태만 서비스 롤로 확인한 뒤
// 카카오페이 결제를 실제로 취소합니다.
// (GoTrue의 /auth/v1/user 세션 체크는 세션 테이블과 엄격히 대조하다보니
//  "session_id claim in JWT does not exist" 같은 오탐이 발생해 제거함)

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { code } = body || {};
  if (!code) {
    return json({ error: "invalid_request" }, 400);
  }

  const sb = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    // 1. 선물 정보 조회 (서비스 롤 — 본인 확인은 이미 RPC에서 끝났다고 신뢰)
    const giftRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/gifts?code=eq.${encodeURIComponent(code)}&select=*`,
      { headers: sb }
    );
    const giftData = await giftRes.json();
    const gift = giftData?.[0];

    if (!gift) {
      return json({ success: false, reason: "not_found" }, 404);
    }

    // 2. 정말 cancelled 상태인지 확인 (RPC를 거치지 않고 이 API를 직접 호출하는 걸 방지)
    if (gift.status !== "cancelled") {
      return json({ success: false, reason: "not_marked_cancelled" }, 403);
    }

    if (!gift.tid || !gift.amount) {
      return json({ success: false, reason: "missing_tid" }, 500);
    }

    const cid = env.KAKAO_CID || "TC0ONETIME";

    // 3. 카카오페이 결제 취소 API 호출
    const cancelRes = await fetch("https://open-api.kakaopay.com/online/v1/payment/cancel", {
      method: "POST",
      headers: {
        Authorization: `SECRET_KEY ${env.KAKAO_PAY_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cid,
        tid: gift.tid,
        cancel_amount: gift.amount,
        cancel_tax_free_amount: 0,
      }),
    });

    if (!cancelRes.ok) {
      const t = await cancelRes.text();
      return json({ success: false, reason: "cancel_api_failed", detail: t.slice(0, 300) }, 500);
    }

    return json({ success: true });
  } catch (err) {
    return json({ success: false, reason: "exception", detail: err.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
