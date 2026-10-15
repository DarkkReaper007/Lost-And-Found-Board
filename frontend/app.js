let provider, signer, contract, account;
const STATUS = ["Open", "Found - awaiting owner", "Returned", "Cancelled"];
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setStatus(msg, ok) {
  const el = $("status");
  el.textContent = msg;
  el.className = ok === undefined ? "" : ok ? "ok" : "err";
}

function errMsg(e) {
  if (e.code === 4001 || e.code === "ACTION_REJECTED") return "Transaction rejected in MetaMask";
  const raw = e?.error?.data?.message || e?.error?.message || e?.data?.message || e?.reason || e?.message || "Unknown error";
  const m = raw.match(/reverted(?: with reason string)?:? ?'?([^'\n]+)'?/);
  return m ? m[1] : raw;
}

// ---------- Connect ----------
$("connectBtn").onclick = async () => {
  if (!window.ethereum) return alert("Please install MetaMask");
  try {
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    account = await signer.getAddress();
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

    const net = await provider.getNetwork();
    $("account").textContent = account;
    $("network").textContent = net.name + " (chainId " + net.chainId + ")";
    $("admin").textContent = await contract.admin();
    setStatus("Wallet connected", true);
    await loadItems();
  } catch (e) {
    setStatus("❌ Connection failed: " + errMsg(e), false);
  }
};

if (window.ethereum) {
  window.ethereum.on("accountsChanged", () => location.reload());
  window.ethereum.on("chainChanged", () => location.reload());
}

// ---------- Send transaction helper ----------
async function send(fn, label) {
  if (!contract) return setStatus("Connect MetaMask first", false);
  try {
    setStatus("Waiting for MetaMask confirmation...");
    const tx = await fn();
    setStatus("Transaction sent, waiting to be mined: " + tx.hash);
    await tx.wait();
    setStatus("✅ " + label + " | Tx hash: " + tx.hash, true);
    await loadItems();
  } catch (e) {
    setStatus("❌ Failed: " + errMsg(e), false);
  }
}

// ---------- Post item ----------
$("postBtn").onclick = () =>
  send(() => contract.postItem(
    $("title").value.trim(),
    $("description").value.trim(),
    $("location").value.trim(),
    { value: ethers.utils.parseEther($("reward").value.trim() || "0") }
  ), "Item posted");

// ---------- Load and display items ----------
async function loadItems() {
  if (!contract) return;
  const count = (await contract.itemCount()).toNumber();
  $("total").textContent = count;
  const box = $("items");
  box.innerHTML = count === 0 ? "<p>No items posted yet.</p>" : "";

  for (let id = count; id >= 1; id--) {
    const it = await contract.getItem(id);
    const st = Number(it.status);
    const active = st === 0 || st === 1;
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <h3>#${it.id} - ${esc(it.title)} <span class="badge s${st}">${STATUS[st]}</span></h3>
      <p>${esc(it.description)}</p>
      <p><b>Lost at:</b> ${esc(it.location)}</p>
      <p><b>Reward in escrow:</b> ${ethers.utils.formatEther(it.reward)} ETH</p>
      <p><b>Posted:</b> ${new Date(it.postedAt.toNumber() * 1000).toLocaleString()}</p>
      <p><b>Owner:</b> <span class="addr">${it.owner}</span></p>
      ${st === 1 ? `<p><b>Finder:</b> <span class="addr">${it.finder}</span><br><b>Note:</b> ${esc(it.foundNote)}</p>` : ""}
      ${st === 2 ? `<p><b>Returned via finder:</b> <span class="addr">${it.finder}</span></p>` : ""}
      <div>
        ${st === 0 ? `<button data-a="found" data-id="${it.id}">I Found This</button>` : ""}
        ${st === 1 ? `<button data-a="confirm" data-id="${it.id}">Confirm Return (pay reward)</button>
                      <button class="secondary" data-a="reject" data-id="${it.id}">Reject Finder</button>` : ""}
        ${active ? `<button class="danger" data-a="cancel" data-id="${it.id}">Cancel (owner)</button>
                    <button class="danger" data-a="admin" data-id="${it.id}">Admin Remove</button>` : ""}
      </div>`;
    box.appendChild(div);
  }
}

$("refreshBtn").onclick = loadItems;

// ---------- Item actions ----------
$("items").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.a) {
    case "found": {
      const note = prompt("Where/how can the owner collect it?");
      send(() => contract.reportFound(id, note || ""), "Found report submitted");
      break;
    }
    case "confirm": send(() => contract.confirmReturn(id), "Return confirmed, reward paid"); break;
    case "reject":  send(() => contract.rejectFinder(id), "Finder rejected, item reopened"); break;
    case "cancel":  send(() => contract.cancelItem(id), "Item cancelled, reward refunded"); break;
    case "admin":   send(() => contract.adminRemoveItem(id), "Item removed by admin"); break;
  }
});