// functions/api/nicepay-approve.js
//
// 나이스페이 결제창에서 인증이 끝나면 이 URL로 결제 결과를 POST로
// 전달합니다(returnUrl). 여기서 tid를 승인 API로 전달해야 실제 결제가
// 최종 확정됩니다. 처리 후 사용자를 다시 우리 사이트로 리다이렉트합니다.

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  let data = {};
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await request.json();
    } else {
      const form = await request.formData();
      for (const [key, value] of form.entries()) data[key] = value;
    }
  } catch {
    return Response.redirect(`${origin}/?payment=fail`, 302);
  }

  const tid = data.tid;
  const orderId = data.orderId;
  const amount = data.amount;

  if (!tid || !orderId) {
    return Response.redirect(`${origin}/?payment=fail`, 302);
  }

  try {
    // 1. 주문 생성 시 저장해둔 정보 조회 (금액 위변조 방지)
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

    if (!order || (amount && String(order.amount) !== String(amount))) {
      return Response.redirect(`${origin}/?payment=fail`, 302);
    }

    // 2. 나이스페이 승인 API 호출
    const credentials = btoa(`${env.NICEPAY_CLIENT_ID}:${env.NICEPAY_SECRET_KEY}`);
    const approveRes = await fetch(`https://api.nicepay.co.kr/v1/payments/${tid}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: order.amount }),
    });

    const approveData = await approveRes.json();
    if (!approveRes.ok || approveData.resultCode !== "0000") {
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
    return Response.redirect(`${origin}/?payment=fail`, 302);
  }
}
