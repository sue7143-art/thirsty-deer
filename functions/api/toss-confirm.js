// functions/api/toss-confirm.js
//
// 결제 완료 후 토스가 이 URL로 돌려보냅니다.
// 1) 결제 승인 → 2) 클릭했던 에피소드 즉시 언락 → 3) 남은 크레딧 1개를 잔액에 적립

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
    // 1. 주문 정보 조회 (금액 위변조 방지)
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

    // 2. 토스페이먼츠 결제 승인
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

    // 4. 남은 크레딧 1개를 잔액에 적립 (기존 잔액을 읽고 +1해서 upsert)
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
    return Response.redirect(`${origin}/?payment=fail`, 302);
  }
}
