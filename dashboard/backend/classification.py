"""
Patent status classification logic.
Ported verbatim from dashboard/app.py — pure functions, no framework dependency.
"""


# ─── Portfolio Outcome Buckets ────────────────────────────

BUCKET_COLORS = {
    "Granted": "#3fb950",
    "Abandoned": "#f85149",
    "Provisional": "#d29922",
    "PCT": "#a371f7",
    "Pending": "#58a6ff",
    "Reexamination": "#79c0ff",
    "Other": "#8b949e",
    "Unknown": "#6e7681",
}


def classify_status(status: str | None) -> tuple[str, str]:
    """Map a raw app_status string to (bucket, sub_category)."""
    if not status:
        return ("Unknown", "No status recorded")
    s = status.strip()

    # Granted
    if s == "Patented Case":
        return ("Granted", "Active patents")
    if "Expired Due to NonPayment" in s or "Maintenance Fees" in s:
        return ("Granted", "Expired — maintenance fees not paid")

    # Abandoned
    if "Failure to Respond" in s:
        return ("Abandoned", "Failed to respond to office action")
    if "Failure to Pay Issue Fee" in s:
        return ("Abandoned", "Failed to pay issue fee")
    if "Expressly Abandoned" in s:
        return ("Abandoned", "Expressly abandoned")
    if "After Examiner" in s or "After Board" in s or "after BPAI" in s:
        return ("Abandoned", "After appeal/board decision")
    if "Incomplete" in s and "Abandon" in s:
        return ("Abandoned", "Incomplete application")
    if "Abandoned" in s:
        return ("Abandoned", "Other abandonment")

    # Provisional
    if "Provisional Application Expired" in s:
        return ("Provisional", "Expired")

    # PCT
    if "RO PROCESSING COMPLETED" in s:
        return ("PCT", "Completed — in storage")
    if "International Search Report" in s or "ISA Form 203" in s:
        return ("PCT", "Search report mailed")
    if "IPER" in s or "International Preliminary" in s:
        return ("PCT", "Preliminary examination report mailed")
    if "Dispatch to TC" in s or "Formal Demand" in s:
        return ("PCT", "Active — processing")
    if "International Application Withdrawn" in s or "Demand Withdrawn" in s:
        return ("PCT", "Withdrawn")
    if s.startswith("PCT"):
        return ("PCT", "Other PCT")

    # Pending — Allowed / near issuance
    if "Notice of Allowance" in s or "Allowed" in s:
        return ("Pending", "Allowed — awaiting issue fee")
    if "Issue Fee Payment" in s:
        return ("Pending", "Issue fee paid — awaiting publication")
    if "Awaiting TC" in s:
        return ("Pending", "Awaiting issue processing")

    # Pending — Examination
    if "Docketed" in s or "Ready for Examination" in s:
        return ("Pending", "Docketed — ready for examination")
    if "Non Final Action" in s or "Non-Final Action" in s or "non-final action" in s:
        return ("Pending", "Non-final office action")
    if "Response to Non-Final" in s or "Response after Non-Final" in s or "response after nonfinal" in s:
        return ("Pending", "Response to non-final action")
    if "Final Rejection" in s:
        return ("Pending", "Final rejection")
    if "Response after Final" in s or "after action closing" in s:
        return ("Pending", "Response after final rejection")
    if "Advisory Action" in s:
        return ("Pending", "Advisory action")
    if "Ex parte Quayle" in s:
        return ("Pending", "Ex parte Quayle action")
    if "Preexam" in s or "preexam" in s or "INFORMALITY" in s:
        return ("Pending", "Pre-examination processing")
    if "Classification" in s:
        return ("Pending", "Classification")

    # Pending — Appeal
    if "Appeal" in s or "appeal" in s:
        return ("Pending", "On appeal")
    if "Board of Appeals" in s:
        return ("Pending", "On appeal")

    # Pending — Other
    if "Prosecution Suspended" in s:
        return ("Pending", "Prosecution suspended")
    if "Withdraw from issue" in s:
        return ("Pending", "Withdrawn from issue")
    if "Court Proceedings" in s:
        return ("Pending", "Court proceedings")

    # Reexamination
    if "Reexam" in s or "reexam" in s or "Supplemental Exam" in s:
        return ("Reexamination", "Reexamination/supplemental")

    return ("Other", s)


# ─── Prosecution Pipeline ─────────────────────────────────

PIPELINE_STAGES = [
    "Pre-Exam",
    "Awaiting First Action",
    "Non-Final Rejection",
    "Applicant Responded",
    "Final Rejection",
    "After Final Response",
    "On Appeal",
    "Allowed",
    "Issue Fee / Publication",
    "Suspended / Other",
]

PIPELINE_COLORS = {
    "Pre-Exam": "#6e7681",
    "Awaiting First Action": "#58a6ff",
    "Non-Final Rejection": "#d29922",
    "Applicant Responded": "#79c0ff",
    "Final Rejection": "#f85149",
    "After Final Response": "#f0883e",
    "On Appeal": "#a371f7",
    "Allowed": "#3fb950",
    "Issue Fee / Publication": "#2ea043",
    "Suspended / Other": "#8b949e",
}

SPLIT_STAGES = {
    "Non-Final Rejection": ["Mailed", "Pending"],
    "Final Rejection": ["Mailed", "Pending", "Advisory Action"],
    "On Appeal": ["Filed / Brief", "Awaiting Decision", "Decision / Other"],
    "Allowed": ["Notice Mailed", "Not Yet Mailed"],
}

STAGE_GLOSSARY = [
    ("Pre-Exam", "Application filed but not yet assigned to a patent examiner. Includes cases awaiting formality review or classification."),
    ("Awaiting First Action", "Assigned to an examiner, waiting for their first review of the claims. This is the initial examination queue."),
    ("Non-Final Rejection", "Examiner rejected one or more claims; applicant can amend and respond.\n- Mailed: Rejection letter sent to applicant\n- Pending: Examiner completed rejection, letter not yet sent"),
    ("Applicant Responded", "Applicant filed amendments or arguments in response to a non-final rejection. Case returned to examiner for further review."),
    ("Final Rejection", "Examiner rejected claims again after applicant's response. Harder to overcome — options are appeal, request for continued examination (RCE), or abandon.\n- Mailed: Final rejection letter sent\n- Pending: Decided but letter not yet sent\n- Advisory Action: Examiner's response to applicant's post-final arguments"),
    ("After Final Response", "Applicant responded to a final rejection, attempting to overcome the rejection without filing an appeal or RCE."),
    ("On Appeal", "Applicant disagreed with examiner's rejection and escalated to the Patent Trial and Appeal Board (PTAB).\n- Filed / Brief: Appeal initiated, brief submitted\n- Awaiting Decision: Board is reviewing the case\n- Decision / Other: Board rendered a decision or other appeal activity"),
    ("Allowed", "USPTO approved the patent claims. Applicant must now pay the issue fee to receive the patent.\n- Notice Mailed: Allowance notice sent to applicant\n- Not Yet Mailed: Examiner approved, notice pending"),
    ("Issue Fee / Publication", "Applicant paid the issue fee. Patent is being processed for publication and grant. Nearly done."),
    ("Suspended / Other", "Prosecution paused due to external factors such as court proceedings, USPTO suspension, or other administrative holds."),
]


def classify_prosecution_stage(status: str | None) -> tuple[str | None, str | None]:
    """Map an active/pending status to (stage, sub_segment)."""
    if not status:
        return None, None
    s = status.strip()

    # Pre-Exam
    if "Preexam" in s or "preexam" in s or "Dispatched from Preexam" in s or "Classification contractor" in s or "INFORMALITY" in s or "Application Undergoing" in s:
        return "Pre-Exam", None

    # Awaiting First Action
    if "Docketed" in s or "Ready for Examination" in s:
        return "Awaiting First Action", None

    # Non-Final Rejection
    if ("Non Final Action" in s or "Non-Final Action" in s) and ("Counted" in s or "Not Yet Mailed" in s):
        return "Non-Final Rejection", "Pending"
    if "Non Final Action" in s or "Non-Final Action" in s or "non-final action" in s:
        return "Non-Final Rejection", "Mailed"

    # Applicant Responded (to non-final)
    if "Response to Non-Final" in s or "Response after Non-Final" in s:
        return "Applicant Responded", None
    if "Response after non-final" in s or "response after nonfinal" in s or "Ready for examiner action after response" in s:
        return "Applicant Responded", None

    # Advisory Action (part of Final Rejection)
    if "Advisory Action" in s:
        return "Final Rejection", "Advisory Action"

    # Final Rejection
    if "Final Rejection" in s and ("Counted" in s or "Not Yet Mailed" in s):
        return "Final Rejection", "Pending"
    if "Final Rejection" in s:
        return "Final Rejection", "Mailed"

    # After Final Response
    if "Response after Final" in s or "after action closing" in s:
        return "After Final Response", None
    if "Ex parte Quayle" in s:
        return "After Final Response", None
    if "Withdraw from issue" in s:
        return "After Final Response", None

    # On Appeal
    if "Notice of Appeal" in s or "Appeal Brief" in s or "Amendment after" in s:
        return "On Appeal", "Filed / Brief"
    if "Awaiting Decision by the Board" in s:
        return "On Appeal", "Awaiting Decision"
    if "Board of Appeals Decision" in s or "Examiner's Answer" in s or "TC Return" in s or "Oral hearing" in s or "Respondent brief" in s:
        return "On Appeal", "Decision / Other"
    if "appeal" in s.lower():
        return "On Appeal", "Filed / Brief"

    # Allowed
    if "Allowed" in s and "Not Yet Mailed" in s:
        return "Allowed", "Not Yet Mailed"
    if "Notice of Allowance" in s:
        return "Allowed", "Notice Mailed"

    # Issue Fee / Publication
    if "Issue Fee" in s or "Awaiting TC" in s or "Pubs Processing" in s:
        return "Issue Fee / Publication", None

    # Suspended / Other
    if "Prosecution Suspended" in s or "Court" in s:
        return "Suspended / Other", None
    if "Abandonment for Failure to Correct" in s:
        return "Suspended / Other", None

    return None, None
