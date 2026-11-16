// Skills: multi-step procedures an agent already knows. Each REQUIRES a set of tools, and the
// required tools are often NOT the ones the task wording points at ("morning briefing" never
// says "calendar"). That gap is where a graph traversal earns its place.
export const SKILLS = [
  ['competitor-watch', 'Monitor competitor websites and pricing pages, record what changed, and alert the team', ['browser_search', 'browser_open', 'memory_save', 'slack__post_message']],
  ['morning-brief', 'Daily briefing: the news that matters, unread mail and today\'s schedule', ['news__top_headlines', 'gmail__list_unread', 'calendar__list_events']],
  ['weekly-report', 'Collect what the team finished this week and write a one-page status report', ['linear__list_my_tickets', 'github__list_pull_requests', 'foundry_create']],
  ['incident-response', 'Investigate a production outage or error, find the cause and alert everyone', ['sentry__list_errors', 'sentry__get_error_details', 'aws__cloudwatch_get_logs', 'slack__post_message']],
  ['release-announcement', 'Publish a new version and announce the release to the team and followers', ['github__create_release', 'social__post_tweet', 'slack__post_message']],
  ['customer-refund', 'Handle a customer refund request: check their history, refund, reply to the ticket', ['support__get_customer_history', 'stripe__refund_payment', 'support__reply_to_ticket']],
  ['invoice-chase', 'Chase overdue invoices and remind late-paying clients, keeping a record', ['accounting__list_invoices', 'gmail__draft_email', 'hubspot__log_call']],
  ['meeting-prep', 'Prepare for an upcoming meeting: who, history, previous emails and notes', ['calendar__get_event', 'hubspot__search_contacts', 'gmail__search_emails', 'notion__search_pages']],
  ['meeting-followup', 'After a meeting: turn the transcript into notes, action items and a recap email', ['zoom__get_transcript', 'notion__create_page', 'linear__create_ticket', 'gmail__send_email']],
  ['new-hire-onboarding', 'Onboard a new employee: calendar, access, introductions', ['hr__list_employees', 'calendar__create_event', 'slack__send_direct_message', 'drive__share_file']],
  ['expense-review', 'Review monthly expenses, reconcile the bank and flag anything unusual', ['accounting__categorize_expense', 'accounting__reconcile_bank', 'math_eval']],
  ['store-daily-check', 'End of day online shop check: sales, orders and visitors', ['shopify__get_sales_report', 'shopify__list_orders', 'analytics__get_site_traffic']],
  ['seo-audit', 'Audit search engine ranking and website traffic', ['analytics__get_search_rankings', 'browser_open', 'analytics__get_site_traffic']],
  ['deploy-and-verify', 'Deploy the website and confirm it really works afterwards', ['vercel__deploy_project', 'vercel__get_deployment_logs', 'browser_open']],
  ['dns-cutover', 'Move a domain to a new server without downtime', ['cloudflare__list_dns_records', 'cloudflare__create_dns_record', 'cloudflare__purge_cache']],
  ['code-review', 'Review a pull request properly: read the changes, check CI, leave a review', ['github__get_pull_request_diff', 'github__review_pull_request', 'github__list_workflow_runs']],
  ['bug-triage', 'Triage new bug reports: sort issues and turn real bugs into tickets', ['github__list_issues', 'linear__create_ticket', 'github__comment_on_issue']],
  ['sales-outreach', 'Prepare personal outreach to new leads and schedule follow-ups', ['hubspot__search_contacts', 'gmail__draft_email', 'hubspot__create_task_hubspot']],
  ['contract-review', 'Read a contract and summarize the risks', ['pdf__pdf_extract_text', 'knowledge_search', 'foundry_create']],
  ['travel-plan', 'Plan a trip: routes, weather, calendar entries and bookings in the inbox', ['maps__get_directions', 'weather__get_forecast', 'calendar__create_event', 'gmail__search_emails']],
  ['data-report', 'Build a periodic metrics report from the database', ['postgres__run_query', 'math_eval', 'foundry_create']],
  ['feedback-digest', 'Summarize what customers are unhappy about this month', ['support__list_support_tickets', 'support__get_csat_report', 'slack__search_messages']],
  ['hiring-pipeline', 'Move candidates through hiring: open roles, interviews, free slots', ['hr__list_open_roles', 'hr__schedule_interview', 'calendar__find_free_time']],
  ['research-brief', 'Research a topic on the web and write a brief with sources', ['browser_search', 'browser_open', 'knowledge_ingest', 'foundry_create']],
  ['file-cleanup', 'Organize and tidy a folder of files', ['fs_list', 'fs_read', 'fs_write']],
  ['code-fix', 'Find and fix a bug or a failing test in the code', ['fs_read', 'fs_edit', 'shell_exec']],
  ['price-check', 'Compare prices across stores and work out the savings', ['browser_search', 'browser_open', 'math_eval']],
  ['backup-check', 'Verify that backup jobs ran and warn the team if they did not', ['aws__s3_list_objects', 'aws__cloudwatch_get_logs', 'slack__post_message']],
  ['social-launch', 'Launch a product on social media with a picture and posts', ['image__generate_image', 'social__post_tweet', 'social__post_linkedin']],
  ['video-repurpose', 'Turn a video into a summary and scheduled social posts', ['youtube__get_transcript_youtube', 'foundry_create', 'social__schedule_social_post']],
];

/** Entities an agent has already resolved: name -> the systems (servers) it lives in. */
export const ENTITIES = [
  ['Acme', ['hubspot', 'stripe', 'slack', 'github']],
  ['Brightwave', ['hubspot', 'accounting', 'gmail', 'drive']],
  ['Northwind', ['linear', 'github', 'sentry', 'notion']],
  ['Sweetcrumb', ['shopify', 'stripe', 'analytics', 'social']],
  ['Kestrel', ['aws', 'sentry', 'docker', 'vercel']],
  ['Orion', ['slack', 'calendar', 'zoom', 'hr']],
];
