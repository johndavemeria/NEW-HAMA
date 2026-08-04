(async function () {
  await initAuth();

  document.getElementById("hero-login-btn").addEventListener("click", signInWithDiscord);

  const { count: memberCount } = await sb
    .from("profiles")
    .select("*", { count: "exact", head: true });

  const { count: founderCount } = await sb
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("role", "founder");

  document.getElementById("stat-members").textContent = memberCount ?? 0;
  document.getElementById("stat-founders").textContent = founderCount ?? 0;
})();
