#!/usr/bin/env python3
"""Simple dashboard for viewing encounters and action items, and triggering Stage C.

Run: streamlit run dashboard.py

Two views (pick from the sidebar):
  - Meeting detail: breadcrumb + Summary/Decisions/Actions/Topics tabs for one encounter,
    modeled on a per-meeting reference UI.
  - Action Items: every open commitment across every encounter, filterable by owner/thread.

A banner at the top surfaces threads reminders.get_flagged_threads() says need a momentum
review before their next meeting, each with a button that runs Stage C in-process.
"""

from __future__ import annotations

import hashlib
from datetime import date

import streamlit as st

from momentum_review import run_momentum_review
from reminders import get_flagged_threads
from smartsheet_sync import get_all_encounters

st.set_page_config(page_title="Momentum Dashboard", layout="wide")

AVATAR_COLORS = ["#4C6EF5", "#20C997", "#F76707", "#AE3EC9", "#0CA678", "#E64980", "#1971C2"]


def avatar_color(name: str) -> str:
    h = int(hashlib.md5(name.encode()).hexdigest(), 16)
    return AVATAR_COLORS[h % len(AVATAR_COLORS)]


def initials(name: str) -> str:
    parts = [p for p in name.replace("(", " ").split() if p.isalpha()]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[1][0]).upper()


def avatar(name: str) -> str:
    color = avatar_color(name)
    return (
        f'<span style="display:inline-flex;align-items:center;justify-content:center;'
        f'width:28px;height:28px;border-radius:50%;background:{color};color:white;'
        f'font-size:12px;font-weight:600;">{initials(name)}</span>'
    )


def topic_pill(text: str) -> str:
    return (
        f'<span style="display:inline-block;padding:4px 12px;margin:0 6px 6px 0;'
        f'border-radius:14px;background:#F1F3F5;color:#495057;font-size:13px;">{text}</span>'
    )


@st.cache_data(ttl=30)
def load_encounters() -> list[dict]:
    return get_all_encounters()


@st.cache_data(ttl=30)
def load_flagged() -> list[dict]:
    return get_flagged_threads()


def render_reminder_banner():
    flagged = load_flagged()
    if not flagged:
        return
    with st.container(border=True):
        st.markdown(f"**{len(flagged)} thread(s) need a momentum review before your next meeting**")
        for f in flagged:
            cols = st.columns([3, 5, 2])
            cols[0].markdown(f"**{f['thread_id']}** · {f['current_state'] or 'unknown'}")
            cols[1].markdown(f"_{f['reason']}_")
            if cols[2].button("Generate review", key=f"gen_{f['thread_id']}"):
                with st.spinner(f"Generating momentum review for {f['thread_id']}..."):
                    review, error = run_momentum_review(f["thread_id"], sync=True)
                if review is None:
                    st.error(error)
                else:
                    st.success(f"Thread state: {review.get('thread_state')}")
                    st.write(review.get("recommended_objective_for_next_meeting"))
                    for wf in review.get("weak_followup_flags", []):
                        st.warning(f"[{wf['flag_type']}] {wf['statement']} → {wf['recommendation']}")
                    load_flagged.clear()


def render_meeting_detail(encounters: list[dict]):
    if not encounters:
        st.info("No encounters recorded yet. Run transcribe_and_extract.py --sync-smartsheet first.")
        return

    labels = [f"{e['encounter_name']} ({e['datetime_local'][:10]})" for e in encounters]
    idx = st.sidebar.selectbox("Encounter", range(len(encounters)), format_func=lambda i: labels[i])
    e = encounters[idx]

    st.caption(f"personal-assistant / meeting / {e.get('thread_id', '')}")
    st.title(e.get("encounter_name", ""))
    participant_count = len(e.get("people_present", []))
    st.caption(f"{e.get('datetime_local', '')} · {participant_count} participant(s) · {e.get('location', '')}")

    if e.get("next_meeting_date"):
        due = e["next_meeting_date"]
        overdue = due <= date.today().isoformat()
        (st.error if overdue else st.info)(f"Follow-up meeting due: {due}")

    tab_summary, tab_decisions, tab_actions, tab_topics = st.tabs(["Summary", "Decisions", "Actions", "Topics"])

    with tab_summary:
        st.markdown(f"**Purpose:** {e.get('pre_meeting_purpose', '')}")
        st.markdown(f"**Momentum status:** {e.get('momentum_status', '')}")
        st.markdown(f"**Next logical action:** {e.get('next_logical_action', '')}")
        st.markdown(f"**State:** {e.get('current_state', '')} · **Impact:** {e.get('impact_assessment', '')}")

    with tab_decisions:
        decisions = e.get("decisions_made", [])
        if decisions:
            for d in decisions:
                st.markdown(f"- {d}")
        else:
            st.caption("No decisions recorded.")

    with tab_actions:
        commitments = e.get("commitments", [])
        if not commitments:
            st.caption("No action items.")
        for c in commitments:
            cols = st.columns([1, 10, 2])
            cols[0].checkbox("mark done", key=f"{e['thread_id']}_{c.get('description')}", label_visibility="collapsed")
            cols[1].markdown(f"{c.get('description')}  \n_due {c.get('due_date') or 'unspecified'}_")
            cols[2].markdown(avatar(c.get("owner") or "?"), unsafe_allow_html=True)

    with tab_topics:
        topics = e.get("topics", [])
        if topics:
            st.markdown("".join(topic_pill(t) for t in topics), unsafe_allow_html=True)
        else:
            st.caption("No topics tagged.")


def render_action_items(encounters: list[dict]):
    st.title("Action Items")

    rows = []
    for e in encounters:
        for c in e.get("commitments", []):
            rows.append({
                "thread_id": e.get("thread_id"),
                "encounter": e.get("encounter_name"),
                "description": c.get("description"),
                "owner": c.get("owner"),
                "due_date": c.get("due_date"),
                "evidence_required": c.get("evidence_required"),
            })

    if not rows:
        st.info("No action items found across any encounter yet.")
        return

    owners = sorted({r["owner"] for r in rows if r["owner"]})
    threads = sorted({r["thread_id"] for r in rows if r["thread_id"]})
    col1, col2 = st.columns(2)
    owner_filter = col1.multiselect("Filter by owner", owners)
    thread_filter = col2.multiselect("Filter by thread", threads)

    filtered = [
        r for r in rows
        if (not owner_filter or r["owner"] in owner_filter)
        and (not thread_filter or r["thread_id"] in thread_filter)
    ]

    for r in filtered:
        cols = st.columns([1, 6, 2, 2])
        cols[0].markdown(avatar(r["owner"] or "?"), unsafe_allow_html=True)
        cols[1].markdown(f"**{r['description']}**  \n_{r['thread_id']} · {r['encounter']}_")
        cols[2].markdown(r["due_date"] or "no due date")
        cols[3].markdown(r["evidence_required"] or "")
        st.divider()


def main():
    st.sidebar.title("Momentum Dashboard")
    view = st.sidebar.radio("View", ["Meeting detail", "Action Items"])

    render_reminder_banner()

    encounters = load_encounters()

    if view == "Meeting detail":
        render_meeting_detail(encounters)
    else:
        render_action_items(encounters)


main()
