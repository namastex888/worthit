// worthit: what your AI coding plans were worth this week, in a side panel.
// Reads ~/.worthit/last.json (written by `npx worthit`); the buttons run worthit itself.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, home, theme, run, props, closeOverlay } from "herdr";

const CMD = ["npx", "-y", "worthit@latest"];
const usd = (n) => "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");   // this runtime has no locale formatting
const short = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? Math.round(n / 1e6) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n));
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const day = (iso) => { const t = new Date(iso + "T00:00:00Z"); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()]; };
const took = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s"; };
const ago = (iso) => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? Math.max(1, Math.round(h * 60)) + " min ago" : h < 48 ? Math.round(h) + " h ago" : Math.round(h / 24) + " days ago"; };

export default class Worthit extends View {
  init(_props, cx) {
    this.data = null; this.missing = false; this.busy = false; this.error = ""; this.since = 0; this.before = "";
    cx.timer.every(60000, (cx) => this.load(cx));
    // while a scan runs: tick the elapsed time, and end as soon as worthit has written a newer file (even if exec never reports back)
    cx.timer.every(5000, (cx) => { if (!this.busy) return; this.load(cx); });
    this.load(cx);
  }

  load(cx) {
    cx.spawn(async (cx) => {
      let text = null;
      try { text = await readTextFile(home() + "/.worthit/last.json"); } catch { text = null; }
      try { this.data = text ? JSON.parse(text) : null; } catch { this.data = null; }
      this.missing = !this.data;
      if (this.busy && this.data && this.data.generated_at !== this.before) this.busy = false;
      cx.notify();
    });
  }

  // a scan without the screen: worthit prices the logs and rewrites last.json
  measure(cx) {
    if (this.busy) return;
    this.busy = true; this.error = ""; this.since = Date.now(); this.before = this.data ? this.data.generated_at : ""; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec(CMD[0], [...CMD.slice(1), "--json", "--no-files"], { timeout: 600000 });
        if (r.code !== 0) this.error = (r.stderr || "worthit failed").trim().split("\n").pop().slice(0, 90);
      } catch (e) { this.error = String(e && e.message ? e.message : e).slice(0, 90); }
      this.busy = false;
      this.load(cx);
    });
  }

  // an overlay closes itself; a copy docked in a layout has no overlay to close
  shut() { const id = props() && props().overlay; if (id) closeOverlay(id); }

  progress(t) {
    return v_flex().gap(2)
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(12).text_color(t.working).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90))
        .child(div().text_size(12).text_color(t.foreground).child("measuring · " + took(Date.now() - this.since))))
      .child(div().text_size(10).text_color(t.dim).child("Reading every saved machine can take a few minutes. You can close this; it keeps going."));
  }

  button(id, label, t, primary, on) {
    return div().id(id).px(10).py(5).rounded(6).text_size(12).font_semibold()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85)).on_click((_e, cx) => on(cx)).child(label);
  }

  plan(p, max, t) {
    const measured = p.proof === "measured", ch = p.change_vs_last_week_pct;
    const note = (p.times_plan_price + "× its price · ") + (measured ? "measured" : "at least");
    return v_flex().gap(4)
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(13).text_color(p.color).child(p.plan))
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child(usd(p.usd_per_full_week))))
      .child(div().h(6).w_full().rounded(3).bg(t.raised)
        .child(div().h(6).rounded(3).bg(p.color).w(Math.max(2, Math.round((p.usd_per_full_week / max) * 100)) + "%")))
      .child(h_flex().justify_between()
        .child(div().text_size(11).text_color(t.dim).child(note))
        .when(measured && ch != null, (el) => el.child(div().text_size(11).text_color(ch >= 0 ? t.done : t.blocked).child((ch >= 0 ? "▲ " : "▼ ") + Math.abs(ch) + "% vs last week"))));
  }

  tile(label, value, t) {
    return v_flex().flex_1().p(8).gap(2).rounded(6).bg(t.surface)
      .child(div().text_size(10).text_color(t.dim).child(label))
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child(value));
  }

  render(_cx) {
    const t = theme(), d = this.data;
    const root = v_flex().size_full().bg(t.popover).p(16).gap(12).text_color(t.foreground).overflow_y_scrollbar();
    root.child(h_flex().justify_between().items_center()
      .child(div().text_size(13).font_semibold().text_color(t.accent).child("WORTHIT"))
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(11).text_color(t.dim).child(d ? "7 days to " + day(d.week.to) : ""))
        .child(div().id("close").px(6).rounded(4).text_size(14).text_color(t.muted).hover((s) => s.bg(t.raised)).on_click(() => this.shut()).child("×"))));

    if (!d) {
      return root
        .child(div().text_size(13).text_color(t.muted).child(this.busy ? "Reading your local logs. The first scan can take a few minutes." : "No run yet. worthit prices the requests in your local AI coding logs and shows what each plan was worth."))
        .when(!!this.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.error)))
        .child(this.busy ? this.progress(t) : h_flex().child(this.button("measure", "Measure now", t, true, (cx) => this.measure(cx))));
    }

    const plans = (d.plans || []).slice().sort((a, b) => b.usd_per_full_week - a.usd_per_full_week), max = Math.max(1, ...plans.map((p) => p.usd_per_full_week));
    root.child(v_flex().gap(4)
      .child(div().text_size(10).text_color(t.dim).child("ONE WEEKLY LIMIT WAS WORTH, AT API PRICES"))
      .child(v_flex().gap(10).children(plans.map((p) => this.plan(p, max, t))))
      .when(!plans.length, (el) => el.child(div().text_size(12).text_color(t.muted).child("No plan measured yet: it needs one finished week."))));

    const g = d.git, tot = d.totals || {};
    root.child(v_flex().gap(6)
      .child(h_flex().gap(6).child(this.tile("TOKENS OUT", short(tot.output_tokens || 0), t)).child(this.tile("API VALUE USED", usd(tot.api_value_usd || 0), t)))
      .when(!!g && g.merged_prs != null, (el) => el.child(h_flex().gap(6).child(this.tile("MERGED PRS", String(g.merged_prs), t)).child(this.tile("COST PER PR", "$" + Number(g.usd_per_merged_pr || 0).toFixed(2), t)))));

    const un = (d.waste || []).reduce((a, x) => a + (x.unused_usd || 0), 0), open = (d.waste || []).reduce((a, x) => a + (x.at_risk_usd || 0), 0);
    const om = d.model_mix && d.model_mix.open, share = om ? Math.round(om.share_pct[om.share_pct.length - 1]) : null;
    root.child(v_flex().gap(4).text_size(12)
      .when(un > 0 || open > 0, (el) => el.child(h_flex().justify_between()
        .child(div().text_color(t.muted).child("Unused last week"))
        .child(div().text_color(un ? t.blocked : t.muted).child(usd(un) + (open ? " · " + usd(open) + " still open" : "")))))
      .when(share != null, (el) => el.child(h_flex().justify_between()
        .child(div().text_color(t.muted).child("Open models"))
        .child(div().text_color(t.foreground).child(share + "% of output")))));

    return root
      .child(h_flex().gap(6).flex_wrap()
        .when(!this.busy, (el) => el.child(this.button("measure", "Measure", t, true, (cx) => this.measure(cx))))
        .child(this.button("report", "Full report", t, false, () => run("tab.new", { name: "worthit", argv: CMD })))
        .child(this.button("share", "Share", t, false, () => run("tab.new", { name: "worthit share", argv: [...CMD, "share"] }))))
      .when(this.busy, (el) => el.child(this.progress(t)))
      .when(!!this.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.error)))
      .child(div().text_size(10).text_color(t.dim).child("updated " + ago(d.generated_at) + " · from your own local logs"));
  }
}
