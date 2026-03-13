#!/usr/bin/env python3
"""Generate a 2-page executive PDF summary of the Polsinelli patent database."""

import sqlite3
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import seaborn as sns
from matplotlib.patches import FancyBboxPatch
from matplotlib.backends.backend_pdf import PdfPages

DB_PATH = 'data/polsinelli.db'
OUTPUT = 'data/Polsinelli_Portfolio_Summary.pdf'

# ── Query data ──────────────────────────────────────────

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

total = c.execute("SELECT COUNT(*) FROM patents").fetchone()[0]
date_range = c.execute("SELECT MIN(filing_date), MAX(filing_date) FROM patents WHERE filing_date IS NOT NULL").fetchone()

# Top 10 applicants
applicants = c.execute("""
    SELECT first_applicant, COUNT(*) FROM patents
    WHERE first_applicant IS NOT NULL AND first_applicant != ''
    GROUP BY first_applicant ORDER BY COUNT(*) DESC LIMIT 10
""").fetchall()

# Filing year distribution
years = c.execute("""
    SELECT substr(filing_date,1,4), COUNT(*) FROM patents
    WHERE filing_date IS NOT NULL
    GROUP BY substr(filing_date,1,4) ORDER BY substr(filing_date,1,4)
""").fetchall()

# Patented (has patent number)
patented = c.execute("SELECT COUNT(*) FROM patents WHERE patent_number IS NOT NULL AND patent_number <> ''").fetchone()[0]

# Art unit (group by TC: 1600 vs 1700)
tc_1600 = c.execute("SELECT COUNT(*) FROM patents WHERE group_art_unit LIKE '16%'").fetchone()[0]
tc_1700 = c.execute("SELECT COUNT(*) FROM patents WHERE group_art_unit LIKE '17%'").fetchone()[0]

# Portfolio outcome buckets
patented_active = c.execute("SELECT COUNT(*) FROM patents WHERE app_status = 'Patented Case'").fetchone()[0]
patented_expired = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Patent Expired%'").fetchone()[0]
abandoned_oa = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Abandoned%Failure to Respond%'").fetchone()[0]
abandoned_fee = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Abandoned%Issue Fee%'").fetchone()[0]
abandoned_other = c.execute("SELECT COUNT(*) FROM patents WHERE (app_status LIKE 'Abandoned%' OR app_status LIKE 'Expressly Abandoned%') AND app_status NOT LIKE '%Failure to Respond%' AND app_status NOT LIKE '%Issue Fee%' AND app_status NOT LIKE '%Appeal%'").fetchone()[0]
abandoned_appeal = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Abandoned%Appeal%' OR app_status LIKE 'Abandoned%Board%'").fetchone()[0]
pct_ro = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'RO PROCESSING%'").fetchone()[0]
all_abandoned = abandoned_oa + abandoned_fee + abandoned_other + abandoned_appeal

# Active prosecution detailed
non_final_mailed = c.execute("SELECT COUNT(*) FROM patents WHERE app_status = 'Non Final Action Mailed'").fetchone()[0]
non_final_counted = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Non Final Action Counted%'").fetchone()[0]
response_nfoa = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Response to Non-Final%'").fetchone()[0]
final_rej_mailed = c.execute("SELECT COUNT(*) FROM patents WHERE app_status = 'Final Rejection Mailed'").fetchone()[0]
final_rej_counted = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Final Rejection Counted%'").fetchone()[0]
response_final = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Response after Final%'").fetchone()[0]
advisory = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Advisory Action%'").fetchone()[0]
docketed = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Docketed%'").fetchone()[0]
allowance = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Notice of Allowance%'").fetchone()[0]
allowed_not_mailed = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Allowed%Not Yet Mailed%'").fetchone()[0]
issue_fee_paid = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Publications%Issue Fee%'").fetchone()[0]
on_appeal_active = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'On Appeal%'").fetchone()[0]
appeal_filed = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Notice of Appeal Filed%'").fetchone()[0]
appeal_brief = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Appeal Brief%'").fetchone()[0]
examiner_answer = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Examiner%Answer%'").fetchone()[0]
board_decision = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Board of Appeals%'").fetchone()[0]
preexam = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Application Undergoing%'").fetchone()[0]
suspended = c.execute("SELECT COUNT(*) FROM patents WHERE app_status LIKE 'Prosecution Suspended%'").fetchone()[0]

active_prosecution = (non_final_mailed + non_final_counted + response_nfoa +
                      final_rej_mailed + final_rej_counted + response_final + advisory +
                      docketed + allowance + allowed_not_mailed + issue_fee_paid +
                      on_appeal_active + appeal_filed + appeal_brief + examiner_answer +
                      board_decision + preexam + suspended)

# Page 2 data
active_by_year = c.execute("""
    SELECT substr(filing_date,1,4) as yr, COUNT(*) FROM patents
    WHERE app_status NOT LIKE 'Patented%' AND app_status NOT LIKE 'Patent Expired%'
    AND app_status NOT LIKE 'Abandoned%' AND app_status NOT LIKE 'Expressly Abandoned%'
    AND app_status NOT LIKE 'RO PROCESSING%'
    AND filing_date IS NOT NULL
    GROUP BY yr ORDER BY yr
""").fetchall()

active_art_units = c.execute("""
    SELECT group_art_unit, COUNT(*) FROM patents
    WHERE app_status NOT LIKE 'Patented%' AND app_status NOT LIKE 'Patent Expired%'
    AND app_status NOT LIKE 'Abandoned%' AND app_status NOT LIKE 'Expressly Abandoned%'
    AND app_status NOT LIKE 'RO PROCESSING%'
    GROUP BY group_art_unit ORDER BY COUNT(*) DESC LIMIT 10
""").fetchall()

active_examiners = c.execute("""
    SELECT examiner, COUNT(*) FROM patents
    WHERE (app_status LIKE 'Non Final Action%' OR app_status LIKE 'Final Rejection%'
    OR app_status LIKE 'Response%' OR app_status LIKE '%Appeal%'
    OR app_status LIKE 'Advisory%' OR app_status LIKE 'Examiner%Answer%')
    AND examiner IS NOT NULL AND examiner != ''
    GROUP BY examiner ORDER BY COUNT(*) DESC LIMIT 10
""").fetchall()

active_applicants = c.execute("""
    SELECT first_applicant, COUNT(*) FROM patents
    WHERE first_applicant IS NOT NULL AND first_applicant != ''
    AND app_status NOT LIKE 'Patented%' AND app_status NOT LIKE 'Patent Expired%'
    AND app_status NOT LIKE 'Abandoned%' AND app_status NOT LIKE 'Expressly Abandoned%'
    AND app_status NOT LIKE 'RO PROCESSING%'
    GROUP BY first_applicant ORDER BY COUNT(*) DESC LIMIT 10
""").fetchall()

conn.close()

# ── Style ───────────────────────────────────────────────

sns.set_theme(style="whitegrid", font_scale=0.65)
DARK = '#2c3e50'
ACCENT = '#2980b9'
GREEN = '#27ae60'
RED = '#e74c3c'
ORANGE = '#f39c12'
BLUE = '#3498db'
PURPLE = '#9b59b6'

def draw_kpi(fig, x, y, val, label, w=0.13, h=0.02):
    box = fig.add_axes([x, y, w, h])
    box.set_xlim(0, 1); box.set_ylim(0, 1)
    box.axis('off')
    rect = FancyBboxPatch((0, 0), 1, 1, boxstyle="round,pad=0.05",
                          facecolor='#f0f4f8', edgecolor='#d0d8e0', linewidth=0.5)
    box.add_patch(rect)
    box.text(0.5, 0.7, val, fontsize=11, fontweight='bold', ha='center', va='center', color=ACCENT)
    box.text(0.5, 0.15, label, fontsize=5.5, ha='center', va='center', color='#666')

# ═══════════════════════════════════════════════════════
# PAGE 1: Portfolio Overview
# ═══════════════════════════════════════════════════════

with PdfPages(OUTPUT) as pdf:

    fig1 = plt.figure(figsize=(11, 8.5))
    gs1 = gridspec.GridSpec(3, 3, figure=fig1, hspace=0.55, wspace=0.4,
                            top=0.76, bottom=0.06, left=0.06, right=0.97)

    # Header
    fig1.text(0.5, 0.97, 'Polsinelli Patent Portfolio Summary', fontsize=18,
              fontweight='bold', ha='center', color=DARK)
    fig1.text(0.5, 0.94, 'Life Sciences & Chemical Engineering  |  USPTO Tech Centers 1600 & 1700',
              fontsize=9, ha='center', color='#555')
    summary = (
        f"12,178 patent applications where Polsinelli PC is listed as correspondence address, "
        f"filed {date_range[0]} to {date_range[1]}. "
        f"Source: USPTO Open Data Portal API, pulled 2026-03-12."
    )
    fig1.text(0.5, 0.915, summary, fontsize=7.5, ha='center', color='#444',
              style='italic')
    fig1.text(0.5, 0.888,
              'API Query: (correspondenceAddressBag.nameLineOneText:*POLSINELLI* OR nameLineTwoText:*POLSINELLI*)'
              ' AND (groupArtUnitNumber:16* OR groupArtUnitNumber:17*)',
              fontsize=5.5, ha='center', color='#999', family='monospace')

    # KPIs
    grant_pct = round(patented * 100 / total)
    kpis = [
        (f'{total:,}', 'Total Applications'),
        (f'{patented:,}', f'Granted Patents ({grant_pct}%)'),
        (f'{tc_1600:,}', 'TC 1600 (Bio/Chem)'),
        (f'{tc_1700:,}', 'TC 1700 (Materials)'),
        (f'{all_abandoned:,}', 'Total Abandoned'),
        (f'{active_prosecution}', 'Active Prosecution'),
    ]
    for i, (val, label) in enumerate(kpis):
        draw_kpi(fig1, 0.06 + i * 0.155, 0.855, val, label)

    # Chart 1: Filing by year
    ax1 = fig1.add_subplot(gs1[0, :2])
    yr_labels = [y[0] for y in years]
    yr_counts = [y[1] for y in years]
    ax1.bar(yr_labels, yr_counts, color=ACCENT, alpha=0.85, width=0.7)
    ax1.set_title('Filing Volume by Year', fontsize=9, fontweight='bold', color=DARK, pad=6)
    ax1.set_ylabel('Applications', fontsize=7)
    ax1.tick_params(axis='x', rotation=45, labelsize=5.5)
    ax1.tick_params(axis='y', labelsize=6)
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    peak_idx = yr_counts.index(max(yr_counts))
    ax1.annotate(f'{max(yr_counts)}', xy=(peak_idx, max(yr_counts)),
                 fontsize=6, ha='center', va='bottom', color=DARK, fontweight='bold')

    # Chart 2: Portfolio outcome pie
    ax2 = fig1.add_subplot(gs1[0, 2])
    remainder = total - patented_active - patented_expired - all_abandoned
    outcome_labels = [
        f'Active Patent\n({patented_active:,})',
        f'Expired Patent\n({patented_expired:,})',
        f'Abandoned\n({all_abandoned:,})',
        f'Active/Pending\n({remainder:,})',
    ]
    outcome_vals = [patented_active, patented_expired, all_abandoned, remainder]
    wedges, texts, autotexts = ax2.pie(
        outcome_vals, labels=outcome_labels, autopct='%1.0f%%',
        colors=[GREEN, ORANGE, RED, BLUE], textprops={'fontsize': 5.5},
        pctdistance=0.75, startangle=90
    )
    for t in autotexts:
        t.set_fontsize(5.5); t.set_fontweight('bold')
    ax2.set_title('Portfolio Outcome', fontsize=9, fontweight='bold', color=DARK, pad=6)

    # Chart 3: Top 10 applicants
    ax3 = fig1.add_subplot(gs1[1, :2])
    app_names = [a[0][:30] for a in applicants]
    app_counts = [a[1] for a in applicants]
    app_names.reverse(); app_counts.reverse()
    palette = sns.color_palette("Blues_d", len(app_names))
    palette.reverse()
    ax3.barh(app_names, app_counts, color=palette)
    ax3.set_title('Top 10 Applicants by Filing Volume', fontsize=9, fontweight='bold', color=DARK, pad=6)
    ax3.set_xlabel('Applications', fontsize=7)
    ax3.tick_params(axis='y', labelsize=6)
    ax3.tick_params(axis='x', labelsize=6)
    ax3.spines['top'].set_visible(False)
    ax3.spines['right'].set_visible(False)
    for i, v in enumerate(app_counts):
        ax3.text(v + 3, i, str(v), fontsize=5.5, va='center', color=DARK)

    # Chart 4: Abandonment breakdown
    ax4 = fig1.add_subplot(gs1[1, 2])
    ab_labels = [
        f'No OA Response\n({abandoned_oa:,})',
        f'After Appeal\n({abandoned_appeal})',
        f'No Issue Fee\n({abandoned_fee})',
        f'Other\n({abandoned_other})',
    ]
    ab_vals = [abandoned_oa, abandoned_appeal, abandoned_fee, abandoned_other]
    ab_colors = ['#e74c3c', '#9b59b6', '#e67e22', '#95a5a6']
    filtered_ab = [(l, v, c) for l, v, c in zip(ab_labels, ab_vals, ab_colors) if v > 0]
    f_labels, f_vals, f_colors = zip(*filtered_ab)
    ax4.pie(f_vals, labels=f_labels, autopct='%1.0f%%',
            colors=f_colors, textprops={'fontsize': 5.5},
            pctdistance=0.75, startangle=90)
    ax4.set_title(f'Why Applications Were Abandoned ({all_abandoned:,})', fontsize=8,
                  fontweight='bold', color=DARK, pad=6)

    # Insights
    ax5 = fig1.add_subplot(gs1[2, :])
    ax5.axis('off')
    insights = [
        (f"Grant Rate: {grant_pct}%",
         f"{patented:,} of {total:,} applications resulted in a patent. In line with the USPTO average for life sciences and chemical arts."),
        (f"Abandoned (No OA Response): {round(abandoned_oa*100/total)}%",
         f"{abandoned_oa:,} applications abandoned because no response was filed to an Office Action. Could be strategic pruning or cost management."),
        (f"Expired Patents: {patented_expired:,}",
         f"Granted patents that expired because maintenance fees were not paid. May indicate intentional portfolio pruning or lapsed oversight."),
        (f"Peak Filing: {yr_labels[peak_idx]} ({max(yr_counts)} apps)",
         f"Filing volume peaked in the mid-2000s and has stabilized around 350-420 applications per year over the last decade."),
    ]
    y = 0.95
    for title, desc in insights:
        ax5.text(0.0, y, title, fontsize=7.5, fontweight='bold', color=DARK, transform=ax5.transAxes)
        ax5.text(0.0, y - 0.12, desc, fontsize=6.5, color='#555', transform=ax5.transAxes, va='top')
        y -= 0.27

    pdf.savefig(fig1, dpi=150, bbox_inches='tight')
    plt.close(fig1)

    # ═══════════════════════════════════════════════════════
    # PAGE 2: Active Prosecution Deep Dive
    # ═══════════════════════════════════════════════════════

    fig2 = plt.figure(figsize=(11, 8.5))
    gs2 = gridspec.GridSpec(3, 2, figure=fig2, hspace=0.5, wspace=0.35,
                            top=0.78, bottom=0.06, left=0.08, right=0.95)

    # Header
    fig2.text(0.5, 0.97, 'Active Prosecution Detail', fontsize=18,
              fontweight='bold', ha='center', color=DARK)
    fig2.text(0.5, 0.94, 'Polsinelli PC  |  Life Sciences & Chemical Engineering  |  TC 1600 & 1700',
              fontsize=9, ha='center', color='#555')
    fig2.text(0.5, 0.915,
              f'{active_prosecution} applications currently in active prosecution (not yet patented, abandoned, or expired).',
              fontsize=8, ha='center', color='#444', style='italic')

    # KPIs for page 2
    total_nfoa = non_final_mailed + non_final_counted
    total_final = final_rej_mailed + final_rej_counted
    total_appeal = on_appeal_active + appeal_filed + appeal_brief + examiner_answer + board_decision
    total_allowed = allowance + allowed_not_mailed + issue_fee_paid

    p2_kpis = [
        (str(total_nfoa + response_nfoa), 'Non-Final OA Stage'),
        (str(total_final + response_final + advisory), 'Final Rejection Stage'),
        (str(total_appeal), 'Appeal Stage'),
        (str(total_allowed), 'Allowed / Pre-Issue'),
        (str(docketed + preexam), 'Awaiting Examination'),
        (str(suspended), 'Suspended'),
    ]
    for i, (val, label) in enumerate(p2_kpis):
        draw_kpi(fig2, 0.06 + i * 0.155, 0.86, val, label)

    # Chart 1: Detailed status breakdown (horizontal bar)
    ax_status = fig2.add_subplot(gs2[0, 0])
    status_items = [
        ('Non-Final OA Mailed', non_final_mailed),
        ('Response to NFOA Filed', response_nfoa),
        ('Final Rejection Mailed', final_rej_mailed),
        ('Response After Final', response_final),
        ('Advisory Action', advisory),
        ('Appeal Filed / Brief Sent', appeal_filed + appeal_brief),
        ('Awaiting Board Decision', on_appeal_active),
        ('Examiner Answer Mailed', examiner_answer),
        ('Board Decision Rendered', board_decision),
        ('Notice of Allowance', allowance),
        ('Issue Fee Paid', issue_fee_paid),
        ('Docketed / New Case', docketed),
        ('Pre-Exam Processing', preexam),
    ]
    # Filter out zeros and sort
    status_items = [(l, v) for l, v in status_items if v > 0]
    status_items.sort(key=lambda x: x[1])
    s_labels = [s[0] for s in status_items]
    s_vals = [s[1] for s in status_items]
    # Color by stage
    def status_color(label):
        if 'Non-Final' in label or 'NFOA' in label:
            return '#f1c40f'
        if 'Final' in label or 'Advisory' in label:
            return RED
        if 'Appeal' in label or 'Board' in label or 'Examiner' in label:
            return PURPLE
        if 'Allowance' in label or 'Issue Fee' in label:
            return GREEN
        return BLUE
    s_colors = [status_color(l) for l in s_labels]
    ax_status.barh(s_labels, s_vals, color=s_colors)
    ax_status.set_title('Current Status Breakdown', fontsize=9, fontweight='bold', color=DARK, pad=6)
    ax_status.tick_params(axis='y', labelsize=6)
    ax_status.tick_params(axis='x', labelsize=6)
    ax_status.spines['top'].set_visible(False)
    ax_status.spines['right'].set_visible(False)
    for i, v in enumerate(s_vals):
        ax_status.text(v + 0.5, i, str(v), fontsize=6, va='center', color=DARK, fontweight='bold')

    # Chart 2: Active cases by filing year
    ax_yr = fig2.add_subplot(gs2[0, 1])
    aby_labels = [y[0] for y in active_by_year if y[0] is not None]
    aby_vals = [y[1] for y in active_by_year if y[0] is not None]
    ax_yr.bar(aby_labels, aby_vals, color=ACCENT, alpha=0.85, width=0.7)
    ax_yr.set_title('Active Cases by Filing Year', fontsize=9, fontweight='bold', color=DARK, pad=6)
    ax_yr.set_ylabel('Applications', fontsize=7)
    ax_yr.tick_params(axis='x', rotation=45, labelsize=5.5)
    ax_yr.tick_params(axis='y', labelsize=6)
    ax_yr.spines['top'].set_visible(False)
    ax_yr.spines['right'].set_visible(False)

    # Chart 3: Top art units with active cases
    ax_au = fig2.add_subplot(gs2[1, 0])
    au_labels = [a[0] for a in active_art_units]
    au_vals = [a[1] for a in active_art_units]
    au_labels.reverse(); au_vals.reverse()
    au_palette = sns.color_palette("Oranges_d", len(au_labels))
    au_palette.reverse()
    ax_au.barh(au_labels, au_vals, color=au_palette)
    ax_au.set_title('Top 10 Art Units (Active Cases)', fontsize=9, fontweight='bold', color=DARK, pad=6)
    ax_au.set_xlabel('Applications', fontsize=7)
    ax_au.tick_params(axis='y', labelsize=6.5)
    ax_au.tick_params(axis='x', labelsize=6)
    ax_au.spines['top'].set_visible(False)
    ax_au.spines['right'].set_visible(False)
    for i, v in enumerate(au_vals):
        ax_au.text(v + 0.3, i, str(v), fontsize=6, va='center', color=DARK, fontweight='bold')

    # Chart 4: Top examiners with active OAs
    ax_ex = fig2.add_subplot(gs2[1, 1])
    ex_labels = [e[0][:25] for e in active_examiners]
    ex_vals = [e[1] for e in active_examiners]
    ex_labels.reverse(); ex_vals.reverse()
    ex_palette = sns.color_palette("Reds_d", len(ex_labels))
    ex_palette.reverse()
    ax_ex.barh(ex_labels, ex_vals, color=ex_palette)
    ax_ex.set_title('Top 10 Examiners (Active OAs/Rejections)', fontsize=9, fontweight='bold', color=DARK, pad=6)
    ax_ex.set_xlabel('Cases', fontsize=7)
    ax_ex.tick_params(axis='y', labelsize=6)
    ax_ex.tick_params(axis='x', labelsize=6)
    ax_ex.spines['top'].set_visible(False)
    ax_ex.spines['right'].set_visible(False)
    for i, v in enumerate(ex_vals):
        ax_ex.text(v + 0.15, i, str(v), fontsize=6, va='center', color=DARK, fontweight='bold')

    # Chart 5: Top applicants with active cases
    ax_ap = fig2.add_subplot(gs2[2, 0])
    aap_labels = [a[0][:25] for a in active_applicants]
    aap_vals = [a[1] for a in active_applicants]
    aap_labels.reverse(); aap_vals.reverse()
    aap_palette = sns.color_palette("Greens_d", len(aap_labels))
    aap_palette.reverse()
    ax_ap.barh(aap_labels, aap_vals, color=aap_palette)
    ax_ap.set_title('Top 10 Applicants (Active Cases)', fontsize=9, fontweight='bold', color=DARK, pad=6)
    ax_ap.set_xlabel('Applications', fontsize=7)
    ax_ap.tick_params(axis='y', labelsize=6)
    ax_ap.tick_params(axis='x', labelsize=6)
    ax_ap.spines['top'].set_visible(False)
    ax_ap.spines['right'].set_visible(False)
    for i, v in enumerate(aap_vals):
        ax_ap.text(v + 0.3, i, str(v), fontsize=6, va='center', color=DARK, fontweight='bold')

    # Insights box
    ax_ins = fig2.add_subplot(gs2[2, 1])
    ax_ins.axis('off')

    total_nfoa_stage = total_nfoa + response_nfoa
    total_final_stage = total_final + response_final + advisory

    p2_insights = [
        ("Non-Final OA Stage",
         f"{total_nfoa_stage} cases awaiting or responding to a first Office Action. This is the earliest rejection\u2014the examiner's initial feedback on the application."),
        ("Final Rejection Stage",
         f"{total_final_stage} cases with a Final Rejection. These need a response, RCE, or appeal to continue. Higher urgency."),
        ("Appeal Stage",
         f"{total_appeal} cases at the Patent Trial and Appeal Board. These are disputes where the applicant disagrees with the examiner's rejection."),
        ("Allowed / Pre-Issue",
         f"{total_allowed} cases approved and awaiting patent issuance. The finish line\u2014just need issue fee payment."),
        ("Most Active Examiner",
         f"{active_examiners[0][0]} has {active_examiners[0][1]} pending cases. Knowing which examiners handle your cases helps predict timelines and rejection patterns."),
    ]

    y = 0.97
    for title, desc in p2_insights:
        ax_ins.text(0.02, y, title, fontsize=7, fontweight='bold', color=DARK, transform=ax_ins.transAxes)
        ax_ins.text(0.02, y - 0.06, desc, fontsize=5.8, color='#555', transform=ax_ins.transAxes, va='top',
                    wrap=True)
        y -= 0.21

    pdf.savefig(fig2, dpi=150, bbox_inches='tight')
    plt.close(fig2)

print(f'Saved: {OUTPUT}')
