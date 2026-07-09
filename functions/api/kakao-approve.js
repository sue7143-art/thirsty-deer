// functions/api/kakao-approve.js
//
// 카카오페이 결제창에서 인증이 끝나면 approval_url(여기)로
// pg_token과 함께 리다이렉트됩니다. tid를 승인 API로 전달해야
// 실제 결제가 최종 확정됩니다.

function fail(origin, reason) {
  return Response.redirect(
    `${origin}/?payment=fail&reason=${encodeURIComponent(reason)}`,
    302
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  const orderId = url.searchParams.get("orderId");
  const pgToken = url.searchParams.get("pg_token");

  if (!orderId || !pgToken) {
    return fail(origin, "missing_params");
  }

  try {
    // 1. 저장해둔 주문 정보(tid 포함) 조회
    const orderRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/pending_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!orderRes.ok) {
      const t = await orderRes.text();
      return fail(origin, "order_fetch_failed:" + t.slice(0, 150));
    }
    const orderData = await orderRes.json();
    const order = orderData?.[0];

    if (!order || !order.tid) {
      return fail(origin, "order_not_found:" + orderId);
    }

    const cid = env.KAKAO_CID || "TC0ONETIME";

    // 2. 카카오페이 결제 승인 API 호출
    const approveRes = await fetch("https://open-api.kakaopay.com/online/v1/payment/approve", {
      method: "POST",
      headers: {
        Authorization: `SECRET_KEY ${env.KAKAO_PAY_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cid,
        tid: order.tid,
        partner_order_id: order.order_id,
        partner_user_id: String(order.user_id),
        pg_token: pgToken,
      }),
    });

    const approveText = await approveRes.text();
    if (!approveRes.ok) {
      return fail(origin, "approve_failed:" + approveText.slice(0, 200));
    }

    // 3. 클릭했던 에피소드 즉시 언락
    await fetch(`${env.SUPABASE_URL}/rest/v1/purchases`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify({
        user_id: order.user_id,
        episode_id: order.episode_id,
      }),
    });

    // 4. 남은 크레딧 1개를 잔액에 적립 (기존 잔액 읽고 +1)
    const creditRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/water_credits?user_id=eq.${order.user_id}&select=balance`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const creditData = await creditRes.json();
    const currentBalance = creditData?.[0]?.balance ?? 0;

    await fetch(`${env.SUPABASE_URL}/rest/v1/water_credits?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: order.user_id,
        balance: currentBalance + 1,
      }),
    });

    // 5. 임시 주문 정리
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/pending_orders?order_id=eq.${encodeURIComponent(orderId)}`,
      {
        method: "DELETE",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    return Response.redirect(`${origin}/?payment=success`, 302);
  } catch (err) {
    return fail(origin, "exception:" + err.message);
  }
}
