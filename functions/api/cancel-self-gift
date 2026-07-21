// functions/api/kakao-cancel-self-gift.js
//
// 본인이 자신에게 보낸 선물을 열었을 때(self_redeem) 호출됩니다.
// gifts 테이블에 저장해둔 tid로 카카오페이 결제를 즉시 취소하고,
// 해당 선물 코드를 cancelled 상태로 막아 다시 못 열게 합니다.
//
// 클라이언트는 로그인한 사용자의 Supabase access_token을
// Authorization: Bearer <token> 헤더로 함께 보내야 합니다.
// (본인 확인 없이는 아무 선물이나 취소할 수 있게 되므로 필수)

// index.html에 이미 공개돼있는 anon key와 동일 (RLS로 보호되는 값이라 노출돼도 안전)
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibG1pcGV4eWxoYmdtc2t4bm5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NzYyNzIsImV4cCI6MjA5ODQ1MjI3Mn0.D3Ie869LyBSUSZaGBKowDTDfCj-pgyI9fpDjYOLxqMU";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { code } = body || {};
  const authHeader = request.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");

  if (!code || !accessToken) {
    return json({ error: "invalid_request" }, 400);
  }

  const sb = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    // 1. 요청자 신원 확인 (전달받은 access_token이 진짜 로그인된 사용자인지)
    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!userRes.ok) {
      return json({ success: false, reason: "not_authenticated" }, 401);
    }
    const user = await userRes.json();
    const userId = user?.id;
    if (!userId) {
      return json({ success: false, reason: "not_authenticated" }, 401);
    }

    // 2. 선물 정보 조회
    const giftRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/gifts?code=eq.${encodeURIComponent(code)}&select=*`,
      { headers: sb }
    );
    const giftData = await giftRes.json();
    const gift = giftData?.[0];

    if (!gift) {
      return json({ success: false, reason: "not_found" }, 404);
    }

    // 3. 정말 본인이 보낸 선물이 맞는지 재확인 (프론트 검증은 신뢰하지 않음)
    if (gift.sender_user_id !== userId) {
      return json({ success: false, reason: "not_sender" }, 403);
    }

    if (gift.status === "redeemed" || gift.status === "cancelled") {
      return json({ success: false, reason: gift.status });
    }

    if (!gift.tid || !gift.amount) {
      return json({ success: false, reason: "missing_tid" }, 500);
    }

    const cid = env.KAKAO_CID || "TC0ONETIME";

    // 4. 카카오페이 결제 취소 API 호출
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

    // 5. 취소 확정된 선물 코드는 다시 못 열도록 상태 변경
    await fetch(`${env.SUPABASE_URL}/rest/v1/gifts?code=eq.${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: {
        ...sb,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status: "cancelled" }),
    });

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
