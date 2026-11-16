// The tool catalog used by the benchmark and the demo.
//
// HONESTY NOTE: the 19 `mimir` tools are Mimir's real built-in tool definitions (dumped from the
// running app, see mimir-real-tools.json). Every other server below is MODELLED on the public
// MCP server of the same name: tool names and one-line descriptions follow what those servers
// expose, but they are written by hand here, not fetched. They exist to give the agent a
// realistic crowd of tools to choose from; none of them is executed by the benchmark.

import fs from 'node:fs';

const real = JSON.parse(fs.readFileSync(new URL('./mimir-real-tools.json', import.meta.url), 'utf8'));

/** server -> [toolName, description, paramNames] */
const MODELLED = {
  github: [
    ['create_issue', 'Create a new issue in a GitHub repository with a title and body', 'repo,title,body,labels'],
    ['get_issue', 'Read one GitHub issue and its comments', 'repo,number'],
    ['list_issues', 'List open or closed issues of a GitHub repository', 'repo,state,labels'],
    ['comment_on_issue', 'Add a comment to a GitHub issue or pull request', 'repo,number,body'],
    ['create_pull_request', 'Open a pull request from one branch into another', 'repo,head,base,title,body'],
    ['list_pull_requests', 'List pull requests of a repository by state', 'repo,state'],
    ['get_pull_request_diff', 'Fetch the code diff of a pull request', 'repo,number'],
    ['review_pull_request', 'Submit a review (approve, comment, request changes) on a pull request', 'repo,number,event,body'],
    ['merge_pull_request', 'Merge an approved pull request', 'repo,number,method'],
    ['create_branch', 'Create a new git branch from a commit or another branch', 'repo,name,from'],
    ['list_commits', 'List recent commits on a branch', 'repo,branch'],
    ['get_file_contents', 'Read a file or directory from a GitHub repository', 'repo,path,ref'],
    ['push_files', 'Commit and push one or more files to a branch', 'repo,branch,files,message'],
    ['search_code', 'Search source code across GitHub repositories', 'query'],
    ['search_repositories', 'Search GitHub for repositories by name or topic', 'query'],
    ['create_repository', 'Create a new GitHub repository', 'name,private'],
    ['fork_repository', 'Fork a repository into your account', 'repo'],
    ['list_workflow_runs', 'List recent CI workflow runs and whether they passed', 'repo,branch'],
    ['create_release', 'Publish a release with a tag and notes', 'repo,tag,notes'],
    ['list_notifications', 'List unread GitHub notifications', 'all'],
  ],
  slack: [
    ['post_message', 'Post a message to a Slack channel', 'channel,text'],
    ['reply_to_thread', 'Reply inside an existing Slack thread', 'channel,thread,text'],
    ['list_channels', 'List the Slack channels in the workspace', 'limit'],
    ['get_channel_history', 'Read recent messages of a Slack channel', 'channel,limit'],
    ['search_messages', 'Search Slack messages by keyword, person or channel', 'query'],
    ['add_reaction', 'React to a Slack message with an emoji', 'channel,timestamp,emoji'],
    ['get_user_profile', 'Look up a Slack user profile and status', 'user'],
    ['send_direct_message', 'Send a private Slack message to a person', 'user,text'],
    ['upload_file', 'Upload a file to a Slack channel', 'channel,path'],
    ['schedule_message', 'Schedule a Slack message to be sent later', 'channel,text,time'],
    ['create_channel', 'Create a new Slack channel', 'name,private'],
    ['set_channel_topic', 'Change the topic of a Slack channel', 'channel,topic'],
  ],
  notion: [
    ['search_pages', 'Search Notion pages and databases by title or text', 'query'],
    ['get_page', 'Read the content of a Notion page', 'page'],
    ['create_page', 'Create a new Notion page with content', 'parent,title,content'],
    ['update_page', 'Edit the content or properties of a Notion page', 'page,content'],
    ['append_block', 'Append text or a checklist to the end of a Notion page', 'page,blocks'],
    ['query_database', 'Query a Notion database with filters and sorts', 'database,filter'],
    ['create_database_entry', 'Add a row to a Notion database', 'database,properties'],
    ['archive_page', 'Archive (soft delete) a Notion page', 'page'],
    ['list_comments', 'List the comments on a Notion page', 'page'],
    ['add_comment', 'Comment on a Notion page', 'page,text'],
    ['list_users', 'List the people in the Notion workspace', 'limit'],
  ],
  linear: [
    ['create_ticket', 'Create a Linear ticket with a title, description and priority', 'team,title,description,priority'],
    ['get_ticket', 'Read a Linear ticket', 'id'],
    ['update_ticket', 'Change the status, assignee or priority of a Linear ticket', 'id,fields'],
    ['search_tickets', 'Search Linear tickets by text, assignee or state', 'query'],
    ['list_my_tickets', 'List the Linear tickets assigned to me', 'state'],
    ['comment_on_ticket', 'Comment on a Linear ticket', 'id,body'],
    ['list_projects', 'List Linear projects and their progress', 'team'],
    ['list_cycles', 'List Linear sprints (cycles) and what is in them', 'team'],
    ['create_project', 'Create a new Linear project', 'team,name'],
    ['list_teams', 'List the teams in Linear', 'limit'],
    ['assign_ticket', 'Assign a Linear ticket to a person', 'id,assignee'],
  ],
  jira: [
    ['create_jira_issue', 'Create a Jira issue in a project', 'project,summary,description,type'],
    ['get_jira_issue', 'Read a Jira issue', 'key'],
    ['search_jira', 'Search Jira issues with a JQL query', 'jql'],
    ['transition_jira_issue', 'Move a Jira issue to another workflow status', 'key,status'],
    ['add_jira_comment', 'Comment on a Jira issue', 'key,body'],
    ['list_jira_sprints', 'List sprints of a Jira board', 'board'],
    ['assign_jira_issue', 'Assign a Jira issue to someone', 'key,assignee'],
    ['log_jira_work', 'Log time worked on a Jira issue', 'key,minutes'],
  ],
  gmail: [
    ['search_emails', 'Search the inbox by sender, subject or text', 'query'],
    ['read_email', 'Read one email with its attachments list', 'id'],
    ['send_email', 'Send an email', 'to,subject,body'],
    ['draft_email', 'Save an email as a draft without sending', 'to,subject,body'],
    ['reply_to_email', 'Reply to an email thread', 'id,body'],
    ['list_labels', 'List Gmail labels', 'limit'],
    ['label_email', 'Apply or remove a label on an email', 'id,label'],
    ['archive_email', 'Archive an email', 'id'],
    ['download_attachment', 'Download an email attachment', 'id,attachment'],
    ['list_unread', 'List unread emails in the inbox', 'limit'],
    ['create_filter', 'Create an inbox filter rule', 'criteria,action'],
  ],
  calendar: [
    ['list_events', 'List calendar events in a date range', 'from,to'],
    ['create_event', 'Create a calendar event with attendees', 'title,start,end,attendees'],
    ['update_event', 'Move or change a calendar event', 'id,fields'],
    ['delete_event', 'Cancel a calendar event', 'id'],
    ['find_free_time', 'Find a free slot that works for several people', 'attendees,duration'],
    ['get_event', 'Read one calendar event', 'id'],
    ['respond_to_invite', 'Accept or decline a meeting invite', 'id,response'],
    ['list_calendars', 'List the available calendars', 'limit'],
  ],
  drive: [
    ['search_files', 'Search Google Drive files by name or content', 'query'],
    ['read_file', 'Read a Google Doc, Sheet or text file', 'id'],
    ['upload_to_drive', 'Upload a file to Google Drive', 'path,folder'],
    ['create_document', 'Create a new Google Doc', 'title,content'],
    ['create_spreadsheet', 'Create a new Google Sheet with rows', 'title,rows'],
    ['update_spreadsheet', 'Write cells into a Google Sheet', 'id,range,values'],
    ['share_file', 'Share a Drive file with a person or link', 'id,email,role'],
    ['list_folder', 'List the files in a Drive folder', 'folder'],
    ['move_file', 'Move a Drive file to another folder', 'id,folder'],
    ['export_pdf', 'Export a Google Doc as PDF', 'id'],
  ],
  postgres: [
    ['run_query', 'Run a read-only SQL query on a Postgres database', 'sql'],
    ['list_tables', 'List the tables in a Postgres database', 'schema'],
    ['describe_table', 'Show the columns and types of a table', 'table'],
    ['explain_query', 'Show the execution plan of a SQL query', 'sql'],
    ['run_migration', 'Apply a SQL migration to the database', 'sql'],
    ['table_row_count', 'Count rows in a Postgres table', 'table'],
  ],
  sqlite: [
    ['sqlite_query', 'Run a SQL query on a local SQLite file', 'file,sql'],
    ['sqlite_schema', 'Show the schema of a SQLite database', 'file'],
    ['sqlite_insert', 'Insert rows into a SQLite table', 'file,table,rows'],
    ['sqlite_export_csv', 'Export a SQLite table to CSV', 'file,table'],
  ],
  cloudflare: [
    ['list_zones', 'List Cloudflare zones (domains)', 'limit'],
    ['list_dns_records', 'List DNS records of a domain', 'zone'],
    ['create_dns_record', 'Add a DNS record to a domain', 'zone,type,name,content'],
    ['delete_dns_record', 'Remove a DNS record', 'zone,id'],
    ['purge_cache', 'Purge the Cloudflare cache of a site', 'zone'],
    ['list_workers', 'List deployed Cloudflare Workers', 'limit'],
    ['deploy_worker', 'Deploy a Cloudflare Worker script', 'name,script'],
    ['list_pages_projects', 'List Cloudflare Pages sites', 'limit'],
    ['get_analytics', 'Get traffic analytics for a domain', 'zone,days'],
    ['list_r2_buckets', 'List R2 storage buckets', 'limit'],
    ['create_tunnel', 'Create a Cloudflare tunnel to expose a local service', 'name'],
  ],
  vercel: [
    ['list_deployments', 'List recent Vercel deployments of a project', 'project'],
    ['get_deployment_logs', 'Read the build logs of a Vercel deployment', 'id'],
    ['deploy_project', 'Deploy a project to Vercel production', 'project'],
    ['list_projects_vercel', 'List Vercel projects', 'limit'],
    ['set_env_var', 'Set an environment variable on a Vercel project', 'project,key,value'],
    ['add_domain', 'Attach a custom domain to a Vercel project', 'project,domain'],
  ],
  stripe: [
    ['list_customers', 'List Stripe customers', 'limit'],
    ['create_invoice', 'Create and send a Stripe invoice', 'customer,items'],
    ['list_payments', 'List recent Stripe payments', 'limit'],
    ['refund_payment', 'Refund a Stripe payment', 'payment,amount'],
    ['create_payment_link', 'Create a Stripe payment link for a product', 'product,price'],
    ['list_subscriptions', 'List active Stripe subscriptions', 'customer'],
    ['get_balance', 'Get the Stripe account balance', 'currency'],
    ['list_disputes', 'List Stripe payment disputes', 'status'],
    ['create_product', 'Create a Stripe product with a price', 'name,price'],
  ],
  hubspot: [
    ['search_contacts', 'Search HubSpot contacts by name, email or company', 'query'],
    ['create_contact', 'Create a HubSpot contact', 'email,name,company'],
    ['update_contact', 'Update a HubSpot contact', 'id,fields'],
    ['list_deals', 'List HubSpot deals by stage', 'stage'],
    ['create_deal', 'Create a HubSpot deal', 'name,amount,contact'],
    ['log_call', 'Log a call or meeting note on a HubSpot contact', 'contact,note'],
    ['list_companies', 'List HubSpot companies', 'query'],
    ['create_task_hubspot', 'Create a follow-up task for a HubSpot contact', 'contact,due,title'],
  ],
  airtable: [
    ['list_bases', 'List Airtable bases', 'limit'],
    ['list_records', 'List records of an Airtable table', 'base,table,filter'],
    ['create_record', 'Add a record to an Airtable table', 'base,table,fields'],
    ['update_record', 'Update an Airtable record', 'base,table,id,fields'],
    ['delete_record', 'Delete an Airtable record', 'base,table,id'],
    ['search_records', 'Search Airtable records by text', 'base,table,query'],
  ],
  discord: [
    ['send_discord_message', 'Send a message to a Discord channel', 'channel,text'],
    ['read_discord_messages', 'Read recent messages of a Discord channel', 'channel,limit'],
    ['list_discord_servers', 'List Discord servers the bot is in', 'limit'],
    ['create_discord_thread', 'Start a thread on a Discord message', 'channel,message,name'],
    ['manage_discord_roles', 'Give or remove a Discord role', 'user,role'],
    ['pin_discord_message', 'Pin a message in a Discord channel', 'channel,message'],
  ],
  zoom: [
    ['create_meeting', 'Create a Zoom meeting and get the join link', 'topic,start,duration'],
    ['list_meetings', 'List upcoming Zoom meetings', 'limit'],
    ['get_recording', 'Get the recording of a past Zoom meeting', 'meeting'],
    ['get_transcript', 'Get the transcript of a Zoom meeting', 'meeting'],
    ['cancel_meeting', 'Cancel a Zoom meeting', 'meeting'],
  ],
  shopify: [
    ['list_orders', 'List Shopify orders by status', 'status'],
    ['get_order', 'Read a Shopify order', 'id'],
    ['list_products', 'List products in the Shopify store', 'limit'],
    ['update_inventory', 'Change the stock level of a Shopify product', 'product,quantity'],
    ['create_discount', 'Create a Shopify discount code', 'code,percent'],
    ['fulfill_order', 'Mark a Shopify order as shipped with tracking', 'order,tracking'],
    ['list_customers_shopify', 'List Shopify customers', 'limit'],
    ['get_sales_report', 'Get a Shopify sales summary for a period', 'from,to'],
  ],
  twilio: [
    ['send_sms', 'Send a text message (SMS) to a phone number', 'to,body'],
    ['make_call', 'Place a phone call that reads a message', 'to,message'],
    ['list_messages', 'List recent SMS messages sent and received', 'limit'],
    ['lookup_number', 'Look up details of a phone number', 'number'],
    ['list_call_logs', 'List recent phone calls', 'limit'],
  ],
  aws: [
    ['s3_list_objects', 'List objects in an S3 bucket', 'bucket,prefix'],
    ['s3_upload', 'Upload a file to an S3 bucket', 'bucket,key,path'],
    ['s3_download', 'Download a file from an S3 bucket', 'bucket,key'],
    ['ec2_list_instances', 'List EC2 servers and their state', 'region'],
    ['ec2_start_instance', 'Start an EC2 server', 'id'],
    ['ec2_stop_instance', 'Stop an EC2 server', 'id'],
    ['cloudwatch_get_logs', 'Read CloudWatch logs of a service', 'group,minutes'],
    ['lambda_invoke', 'Invoke an AWS Lambda function', 'name,payload'],
    ['cost_explorer_report', 'Get the AWS cost for a month by service', 'month'],
  ],
  docker: [
    ['list_containers', 'List running Docker containers', 'all'],
    ['container_logs', 'Read the logs of a Docker container', 'id,tail'],
    ['start_container', 'Start a Docker container', 'id'],
    ['stop_container', 'Stop a Docker container', 'id'],
    ['build_image', 'Build a Docker image from a Dockerfile', 'path,tag'],
    ['run_image', 'Run a Docker image as a new container', 'image,ports,env'],
    ['list_images', 'List local Docker images', 'limit'],
  ],
  sentry: [
    ['list_errors', 'List recent errors in Sentry by project', 'project'],
    ['get_error_details', 'Read one Sentry error with its stack trace', 'id'],
    ['resolve_error', 'Mark a Sentry error as resolved', 'id'],
    ['list_releases', 'List Sentry releases and their health', 'project'],
    ['get_error_stats', 'Get error counts over time', 'project,days'],
  ],
  figma: [
    ['get_design_file', 'Read the layers and frames of a Figma file', 'file'],
    ['export_frame', 'Export a Figma frame as PNG or SVG', 'file,frame,format'],
    ['list_comments_figma', 'List comments on a Figma file', 'file'],
    ['add_comment_figma', 'Comment on a Figma file', 'file,text'],
    ['get_design_tokens', 'Get colors and fonts used in a Figma file', 'file'],
  ],
  youtube: [
    ['search_videos', 'Search YouTube videos', 'query'],
    ['get_transcript_youtube', 'Get the transcript of a YouTube video', 'video'],
    ['get_channel_stats', 'Get views and subscribers of a YouTube channel', 'channel'],
    ['list_playlist', 'List the videos in a YouTube playlist', 'playlist'],
  ],
  maps: [
    ['geocode', 'Turn an address into coordinates', 'address'],
    ['get_directions', 'Get driving or walking directions with travel time', 'from,to,mode'],
    ['search_places', 'Find places such as cafes or shops near a location', 'query,location'],
    ['get_place_details', 'Get opening hours, rating and phone of a place', 'place'],
    ['distance_matrix', 'Get travel times between several places', 'origins,destinations'],
  ],
  weather: [
    ['get_forecast', 'Get the weather forecast for a city', 'city,days'],
    ['get_current_weather', 'Get the current weather for a city', 'city'],
    ['get_air_quality', 'Get the air quality for a city', 'city'],
  ],
  news: [
    ['search_news', 'Search recent news articles', 'query'],
    ['top_headlines', 'Get top headlines by country or topic', 'topic'],
    ['summarize_article', 'Fetch and summarize a news article', 'url'],
  ],
  pdf: [
    ['pdf_extract_text', 'Extract the text of a PDF file', 'path'],
    ['pdf_merge', 'Merge several PDF files into one', 'paths'],
    ['pdf_split', 'Split a PDF into pages or ranges', 'path,ranges'],
    ['pdf_fill_form', 'Fill the fields of a PDF form', 'path,fields'],
    ['pdf_to_images', 'Convert PDF pages to images', 'path'],
  ],
  image: [
    ['generate_image', 'Generate an image from a text description', 'prompt,size'],
    ['edit_image', 'Edit an existing image with instructions', 'path,prompt'],
    ['remove_background', 'Remove the background from an image', 'path'],
    ['resize_image', 'Resize or crop an image', 'path,width,height'],
    ['ocr_image', 'Read the text in an image or screenshot', 'path'],
  ],
  translate: [
    ['translate_text', 'Translate text into another language', 'text,to'],
    ['detect_language', 'Detect the language of a text', 'text'],
    ['translate_document', 'Translate a whole document file', 'path,to'],
  ],
  analytics: [
    ['get_site_traffic', 'Get website visitors and top pages for a period', 'site,days'],
    ['get_conversion_funnel', 'Get the signup or checkout conversion funnel', 'site,funnel'],
    ['get_ad_spend', 'Get advertising spend and return by campaign', 'platform,days'],
    ['list_ab_tests', 'List running A/B tests and their results', 'site'],
    ['get_search_rankings', 'Get search engine rankings for keywords', 'site,keywords'],
  ],
  social: [
    ['post_tweet', 'Publish a post on X (Twitter)', 'text'],
    ['search_tweets', 'Search recent posts on X', 'query'],
    ['post_linkedin', 'Publish a post on LinkedIn', 'text'],
    ['schedule_social_post', 'Schedule a social media post', 'platform,text,time'],
    ['get_social_mentions', 'Get recent mentions of the brand on social media', 'brand'],
  ],
  hr: [
    ['list_employees', 'List employees in the HR system', 'department'],
    ['request_time_off', 'Submit a time-off request', 'from,to,type'],
    ['get_payroll_summary', 'Get the payroll summary for a month', 'month'],
    ['list_open_roles', 'List open job positions', 'department'],
    ['schedule_interview', 'Schedule a job interview with a candidate', 'candidate,time'],
  ],
  support: [
    ['list_support_tickets', 'List customer support tickets by status', 'status'],
    ['reply_to_ticket', 'Reply to a customer support ticket', 'ticket,body'],
    ['close_ticket', 'Close a customer support ticket', 'ticket'],
    ['get_customer_history', 'Get past tickets and orders of a customer', 'customer'],
    ['get_csat_report', 'Get customer satisfaction scores for a period', 'days'],
  ],
  accounting: [
    ['list_invoices', 'List accounting invoices by status', 'status'],
    ['create_bill', 'Record a supplier bill', 'vendor,amount,due'],
    ['get_profit_loss', 'Get the profit and loss report for a period', 'from,to'],
    ['categorize_expense', 'Categorize an expense transaction', 'transaction,category'],
    ['reconcile_bank', 'Match bank transactions with accounting entries', 'account'],
    ['get_tax_summary', 'Get the sales tax summary for a period', 'from,to'],
  ],
};

export const SERVERS = [
  { name: 'mimir', title: 'Mimir built-ins', real: true },
  ...Object.keys(MODELLED).map(name => ({ name, title: name, real: false })),
];

export const TOOLS = [
  ...real.map(t => ({ id: t.name, server: 'mimir', description: t.description, params: t.params, chars: t.chars, real: true })),
  ...Object.entries(MODELLED).flatMap(([server, list]) =>
    list.map(([name, description, params]) => {
      const id = `${server}__${name}`;
      const paramList = params.split(',').filter(Boolean);
      const schema = {
        type: 'function',
        function: {
          name: id,
          description,
          parameters: { type: 'object', properties: Object.fromEntries(paramList.map(p => [p, { type: 'string', description: `The ${p}` }])), required: paramList.slice(0, 2) },
        },
      };
      return { id, server, description, params: paramList, chars: JSON.stringify(schema).length, real: false };
    }),
  ),
];

/** Full OpenAI/Ollama-style function schema for a catalog tool (real tools get a generic parameter object). */
export function toSchema(tool) {
  return {
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries((tool.params || []).map(p => [p, { type: 'string', description: `The ${p}` }])),
        required: (tool.params || []).slice(0, 2),
      },
    },
  };
}

export const CATALOG_STATS = () => ({
  servers: SERVERS.length,
  tools: TOOLS.length,
  realTools: TOOLS.filter(t => t.real).length,
  schemaChars: TOOLS.reduce((s, t) => s + JSON.stringify(toSchema(t)).length, 0),
});
