// functions/api/toss-confirm.js
//
// 토스페이먼츠 결제창에서 결제가 끝나면 successUrl(여기)로 돌아옵니다.
// 이때 토스가 쿼리스트링에 paymentKey, orderId, amount를 자동으로 붙여줍니다.
// 여기서 실제 승인(confirm) API를 호출해야 결제가 최종 완료됩니다.

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  const paymentKey = url.searchParams.get("paymentKey");
  const orderId = url.searchParams.get("orderId");
  const amount = url.searchParams.get("amount");

  if (!paymentKey || !orderId || !amount) {
    return Response.redirect(`${origin}/?payment=fail`, 302);
  }

  try {
    // 1. 결제 시작 시 저장해둔 주문 정보 조회 (금액 위변조 방지)
    const orderRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/pending_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const orderData = await orderRes.json();
    const order = orderData?.[0];

    if (!order || String(order.amount) !== String(amount)) {
      return Response.redirect(`${origin}/?payment=fail`, 302);
    }

    // 2. 토스페이먼츠 결제 승인 API 호출
    const authHeader = "Basic " + btoa(`${env.TOSS_SECRET_KEY}:`);
    const confirmRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount),
      }),
    });

    if (!confirmRes.ok) {
      return Response.redirect(`${origin}/?payment=fail`, 302);
    }

    // 3. 구매 내역 저장 (번들에 포함된 모든 에피소드를 각각 한 줄씩)
    const rows = order.episodes.map((epId) => ({
      user_id: order.user_id,
      episode_id: epId,
    }));

    await fetch(`${env.SUPABASE_URL}/rest/v1/purchases`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify(rows),
    });

    // 4. 임시 주문 정리
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

    return Response.redirect(`${origin}/?payment=success&bundle=${order.bundle_id}`, 302);
  } catch (err) {
    return Response.redirect(`${origin}/?payment=fail`, 302);
  }
}
