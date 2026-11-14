-- SaiU Chess Club — PostgreSQL schema
-- Generated from the tables and fields the feature modules write.
-- Tables are prefixed "chess_" so they never collide with other applications in the same project.
-- Every table: id text primary key, "createdAt"/"updatedAt" timestamptz.

create table if not exists "chess_academic_year_events" (
  id text primary key
,  "academicYearId" text
,  "title" text
,  "kind" text
,  "startsOn" text
,  "endsOn" text
,  "source" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_academic_year_events_created_idx" on "chess_academic_year_events" ("createdAt" desc);

create table if not exists "chess_academic_years" (
  id text primary key
,  "label" text
,  "startsOn" text
,  "endsOn" text
,  "isCurrent" boolean
,  "version" numeric
,  "status" text
,  "supersedes" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
,  "activatedBy" text
,  "activatedAt" timestamptz
,  "supersededBy" text
,  "name" text
,  "kind" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "supersedesId" text
,  "proposedBy" text
,  "supersededById" text
,  "supersededAt" timestamptz
);
create index if not exists "chess_academic_years_created_idx" on "chess_academic_years" ("createdAt" desc);

create table if not exists "chess_academy_coach_links" (
  id text primary key
,  "coachId" text
,  "learnerId" text
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_academy_coach_links_created_idx" on "chess_academy_coach_links" ("createdAt" desc);

create table if not exists "chess_academy_courses" (
  id text primary key
,  "title" text
,  "summary" text
,  "level" text
,  "prerequisites" jsonb
,  "status" text
,  "version" numeric
,  "authorId" text
,  "reviewerId" text
,  "source" text
,  "licence" text
,  "publishedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_academy_courses_created_idx" on "chess_academy_courses" ("createdAt" desc);

create table if not exists "chess_academy_enrollments" (
  id text primary key
,  "courseId" text
,  "userId" text
,  "status" text
,  "enrolledAt" timestamptz
);
create index if not exists "chess_academy_enrollments_created_idx" on "chess_academy_enrollments" ("createdAt" desc);

create table if not exists "chess_academy_lessons" (
  id text primary key
,  "courseId" text
,  "title" text
,  "order" numeric
,  "content" text
,  "kind" text
,  "status" text
,  "version" numeric
,  "authorId" text
,  "createdAt" timestamptz
,  "reviewerId" text
,  "publishedAt" timestamptz
);
create index if not exists "chess_academy_lessons_created_idx" on "chess_academy_lessons" ("createdAt" desc);

create table if not exists "chess_academy_progress" (
  id text primary key
,  "courseId" text
,  "lessonId" text
,  "userId" text
,  "status" text
,  "score" text
,  "completedAt" timestamptz
);
create index if not exists "chess_academy_progress_created_idx" on "chess_academy_progress" ("createdAt" desc);

create table if not exists "chess_academy_puzzle_attempts" (
  id text primary key
,  "puzzleId" text
,  "userId" text
,  "topic" text
,  "solved" boolean
,  "at" text
);
create index if not exists "chess_academy_puzzle_attempts_created_idx" on "chess_academy_puzzle_attempts" ("createdAt" desc);

create table if not exists "chess_accessibility_issues" (
  id text primary key
,  "feature" text
,  "description" text
,  "severity" text
,  "wcagCriterion" text
,  "assistiveTech" text
,  "reportedBy" text
,  "status" text
,  "resolution" text
,  "resolvedBy" text
,  "resolvedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_accessibility_issues_created_idx" on "chess_accessibility_issues" ("createdAt" desc);

create table if not exists "chess_accessibility_preferences" (
  id text primary key
,  "userId" text
,  "reducedMotion" text
,  "highContrast" boolean
,  "contrastMode" text
,  "fontScale" numeric
,  "colorBlindSafeBoard" boolean
,  "underlineLinks" boolean
,  "screenReaderAnnouncements" boolean
,  "keyboardOnlyHints" boolean
,  "updatedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_accessibility_preferences_created_idx" on "chess_accessibility_preferences" ("createdAt" desc);

create table if not exists "chess_achievement_templates" (
  id text primary key
,  "code" text
,  "name" text
,  "version" numeric
,  "active" boolean
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_achievement_templates_created_idx" on "chess_achievement_templates" ("createdAt" desc);

create table if not exists "chess_achievements" (
  id text primary key
,  "recipientId" text
,  "type" text
,  "title" text
,  "description" text
,  "sourceType" text
,  "sourceId" text
,  "status" text
,  "reason" text
,  "nominatedBy" text
,  "approvingOfficialId" text
,  "consentPublic" boolean
,  "awardedBy" text
,  "awardedAt" timestamptz
,  "createdAt" timestamptz
,  "disputeReason" text
,  "disputedAt" timestamptz
,  "consentUpdatedAt" timestamptz
,  "approvedAt" timestamptz
);
create index if not exists "chess_achievements_created_idx" on "chess_achievements" ("createdAt" desc);

create table if not exists "chess_ai_budget_ledger" (
  id text primary key
,  "callId" text
,  "kind" text
,  "paise" numeric
,  "balanceAfterPaise" numeric
,  "useCase" text
,  "actorId" text
,  "at" text
,  "createdAt" timestamptz
);
create index if not exists "chess_ai_budget_ledger_created_idx" on "chess_ai_budget_ledger" ("createdAt" desc);

create table if not exists "chess_ai_calls" (
  id text primary key
,  "actorId" text
,  "useCase" text
,  "promptChars" numeric
,  "costPaise" numeric
,  "outcome" text
,  "ledgerId" text
,  "at" text
,  "createdAt" timestamptz
,  "reason" text
);
create index if not exists "chess_ai_calls_created_idx" on "chess_ai_calls" ("createdAt" desc);

create table if not exists "chess_ai_proposals" (
  id text primary key
,  "targetTable" text
,  "summary" text
,  "useCase" text
,  "status" text
,  "advisoryOnly" boolean
,  "applied" boolean
,  "appliedByAi" boolean
,  "requiresManualEntry" boolean
,  "createdBy" text
,  "createdAt" timestamptz
,  "decidedBy" text
,  "decidedAt" timestamptz
,  "decisionNote" text
);
create index if not exists "chess_ai_proposals_created_idx" on "chess_ai_proposals" ("createdAt" desc);

create table if not exists "chess_alumni_access_requests" (
  id text primary key
,  "userId" text
,  "contactEmail" text
,  "contactEmailVerified" boolean
,  "verificationCode" text
,  "graduationYear" numeric
,  "programme" text
,  "status" text
,  "reviewedBy" text
,  "reviewReason" text
,  "decidedAt" timestamptz
,  "submittedAt" timestamptz
,  "createdAt" timestamptz
,  "contactEmailVerifiedAt" timestamptz
);
create index if not exists "chess_alumni_access_requests_created_idx" on "chess_alumni_access_requests" ("createdAt" desc);

create table if not exists "chess_alumni_history_entries" (
  id text primary key
,  "title" text
,  "year" numeric
,  "category" text
,  "description" text
,  "attributedUserId" text
,  "recordedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_alumni_history_entries_created_idx" on "chess_alumni_history_entries" ("createdAt" desc);

create table if not exists "chess_alumni_profiles" (
  id text primary key
,  "headline" text
,  "userId" text
,  "requestId" text
,  "status" text
,  "graduationYear" numeric
,  "programme" text
,  "directoryVisible" boolean
,  "shareContact" boolean
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "suspendedAt" timestamptz
,  "revokedAt" timestamptz
,  "createdAt" timestamptz
,  "statusReason" text
,  "statusChangedBy" text
,  "statusChangedAt" timestamptz
);
create index if not exists "chess_alumni_profiles_created_idx" on "chess_alumni_profiles" ("createdAt" desc);

create table if not exists "chess_analysis_ai_credits" (
  id text primary key
,  "userId" text
,  "credits" numeric
,  "createdAt" timestamptz
);
create index if not exists "chess_analysis_ai_credits_created_idx" on "chess_analysis_ai_credits" ("createdAt" desc);

create table if not exists "chess_analysis_games" (
  id text primary key
,  "ownerId" text
,  "source" text
,  "filename" text
,  "headers" jsonb
,  "white" text
,  "black" text
,  "event" text
,  "result" text
,  "moves" jsonb
,  "plyCount" numeric
,  "fen" text
,  "tags" jsonb
,  "visibility" text
,  "createdAt" timestamptz
);
create index if not exists "chess_analysis_games_created_idx" on "chess_analysis_games" ("createdAt" desc);

create table if not exists "chess_analysis_reviews" (
  id text primary key
,  "gameId" text
,  "requestedBy" text
,  "mode" text
,  "depth" numeric
,  "engine" text
,  "enginePerformanceBounded" boolean
,  "label" text
,  "officialResultAffecting" boolean
,  "summary" text
,  "themes" jsonb
,  "candidatePlans" jsonb
,  "aiExplanation" text
,  "aiCreditsRemaining" numeric
,  "createdAt" timestamptz
);
create index if not exists "chess_analysis_reviews_created_idx" on "chess_analysis_reviews" ("createdAt" desc);

create table if not exists "chess_arena_events" (
  id text primary key
,  "gameId" text
,  "action" text
,  "actorId" text
,  "detail" jsonb
,  "at" text
);
create index if not exists "chess_arena_events_created_idx" on "chess_arena_events" ("createdAt" desc);

create table if not exists "chess_arena_games" (
  id text primary key
,  "mode" text
,  "status" text
,  "tournamentId" text
,  "whitePlayerId" text
,  "blackPlayerId" text
,  "timeControl" jsonb
,  "clock" jsonb
,  "ratingImpact" boolean
,  "ratingApplied" boolean
,  "ratingAppliedAt" timestamptz
,  "ratingPipelineStatus" text
,  "result" text
,  "pgn" text
,  "moves" jsonb
,  "startedAt" timestamptz
,  "endedAt" timestamptz
,  "blockedModeConfirmed" boolean
,  "disconnectedSide" text
,  "clockBehavior" text
,  "createdBy" text
,  "invitationAccepted" boolean
,  "invitationId" text
,  "resultReason" text
,  "disconnectedAt" timestamptz
,  "reconnectedAt" timestamptz
);
create index if not exists "chess_arena_games_created_idx" on "chess_arena_games" ("createdAt" desc);

create table if not exists "chess_arena_invitations" (
  id text primary key
,  "inviteeId" text
,  "inviterId" text
,  "status" text
,  "expiresAt" timestamptz
,  "respondedAt" timestamptz
,  "gameId" text
);
create index if not exists "chess_arena_invitations_created_idx" on "chess_arena_invitations" ("createdAt" desc);

create table if not exists "chess_arena_reports" (
  id text primary key
,  "gameId" text
,  "tournamentId" text
,  "reportedBy" text
,  "category" text
,  "detail" text
,  "status" text
,  "isFinding" boolean
,  "sanctionApplied" boolean
,  "reviewedBy" text
,  "reviewedAt" timestamptz
,  "outcome" text
,  "reviewNote" text
);
create index if not exists "chess_arena_reports_created_idx" on "chess_arena_reports" ("createdAt" desc);

create table if not exists "chess_attendance_alerts" (
  id text primary key
,  "matchId" text
,  "tournamentId" text
,  "playerId" text
,  "kind" text
,  "threshold" text
,  "status" text
,  "raisedAt" timestamptz
,  "organizerNotified" boolean
,  "resolvedBy" text
);
create index if not exists "chess_attendance_alerts_created_idx" on "chess_attendance_alerts" ("createdAt" desc);

create table if not exists "chess_attendance_events" (
  id text primary key
,  "matchId" text
,  "action" text
,  "actorId" text
,  "detail" jsonb
,  "at" text
);
create index if not exists "chess_attendance_events_created_idx" on "chess_attendance_events" ("createdAt" desc);

create table if not exists "chess_attendance_explanations" (
  id text primary key
,  "matchId" text
,  "tournamentId" text
,  "playerId" text
,  "category" text
,  "text" text
,  "visibility" text
,  "status" text
,  "reviewedBy" text
,  "reviewedAt" timestamptz
,  "decision" text
,  "reviewNote" text
);
create index if not exists "chess_attendance_explanations_created_idx" on "chess_attendance_explanations" ("createdAt" desc);

create table if not exists "chess_attendance_incidents" (
  id text primary key
,  "matchId" text
,  "tournamentId" text
,  "action" text
,  "reason" text
,  "actorId" text
,  "previousStatus" text
,  "newStatus" text
,  "at" text
);
create index if not exists "chess_attendance_incidents_created_idx" on "chess_attendance_incidents" ("createdAt" desc);

create table if not exists "chess_attendance_matches" (
  id text primary key
,  "tournamentId" text
,  "whitePlayerId" text
,  "blackPlayerId" text
,  "startsAt" timestamptz
,  "checkInOpensAt" timestamptz
,  "graceEndsAt" timestamptz
,  "board" numeric
,  "round" numeric
,  "status" text
,  "attendanceStatus" text
,  "walkover" jsonb
,  "emergencyAction" text
,  "attendanceReopened" boolean
,  "createdBy" text
,  "resultSource" text
,  "emergencyReason" text
,  "emergencyBy" text
,  "emergencyAt" timestamptz
);
create index if not exists "chess_attendance_matches_created_idx" on "chess_attendance_matches" ("createdAt" desc);

create table if not exists "chess_attendance_records" (
  id text primary key
,  "matchId" text
,  "tournamentId" text
,  "playerId" text
,  "status" text
,  "checkedInAt" timestamptz
,  "late" boolean
,  "beyondGrace" boolean
,  "flagged" boolean
,  "checkInSource" text
,  "decidedBy" text
,  "decidedAt" timestamptz
,  "reason" text
,  "reopened" boolean
,  "recordedBy" text
);
create index if not exists "chess_attendance_records_created_idx" on "chess_attendance_records" ("createdAt" desc);

create table if not exists "chess_award_categories" (
  id text primary key
,  "seasonId" text
,  "kind" text
,  "name" text
,  "minGames" numeric
,  "pool" text
,  "baselineStart" text
,  "baselineEnd" text
,  "criteria" jsonb
,  "criteriaPublishedAt" timestamptz
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
,  "winnerId" text
);
create index if not exists "chess_award_categories_created_idx" on "chess_award_categories" ("createdAt" desc);

create table if not exists "chess_award_nominations" (
  id text primary key
,  "seasonId" text
,  "categoryId" text
,  "nominatedUserId" text
,  "nominatedBy" text
,  "reason" text
,  "status" text
,  "reviewedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_award_nominations_created_idx" on "chess_award_nominations" ("createdAt" desc);

create table if not exists "chess_award_winners" (
  id text primary key
,  "seasonId" text
,  "categoryId" text
,  "categoryKind" text
,  "userId" text
,  "score" numeric
,  "basis" text
,  "certificateId" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "publishedAt" timestamptz
,  "status" text
,  "version" numeric
);
create index if not exists "chess_award_winners_created_idx" on "chess_award_winners" ("createdAt" desc);

create table if not exists "chess_calendar_entries" (
  id text primary key
,  "seriesId" text
,  "title" text
,  "type" text
,  "source" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "timezone" text
,  "venueId" text
,  "hostId" text
,  "audience" jsonb
,  "academicYearId" text
,  "status" text
,  "conflictWarnings" jsonb
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_calendar_entries_created_idx" on "chess_calendar_entries" ("createdAt" desc);

create table if not exists "chess_certificates" (
  id text primary key
,  "achievementId" text
,  "recipientId" text
,  "templateCode" text
,  "templateVersion" numeric
,  "verificationCode" text
,  "status" text
,  "issuedBy" text
,  "issuedAt" timestamptz
,  "revokedBy" text
,  "revokeReason" text
,  "revokedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_certificates_created_idx" on "chess_certificates" ("createdAt" desc);

create table if not exists "chess_championship_seasons" (
  id text primary key
,  "name" text
,  "year" numeric
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "status" text
,  "criteriaPublishedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_championship_seasons_created_idx" on "chess_championship_seasons" ("createdAt" desc);

create table if not exists "chess_club_events" (
  id text primary key
,  "title" text
,  "description" text
,  "category" text
,  "hostId" text
,  "eligibility" text
,  "visibility" text
,  "capacity" numeric
,  "waitlistEnabled" boolean
,  "registrationMode" text
,  "registrationOpensAt" timestamptz
,  "registrationClosesAt" timestamptz
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "venue" text
,  "meetingLink" text
,  "accessibility" text
,  "materials" jsonb
,  "cancellationPolicy" text
,  "notificationRules" jsonb
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
,  "publishedAt" timestamptz
,  "publishedBy" text
);
create index if not exists "chess_club_events_created_idx" on "chess_club_events" ("createdAt" desc);

create table if not exists "chess_coaching_assignments" (
  id text primary key
,  "coachId" text
,  "studentId" text
,  "offeringId" text
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_coaching_assignments_created_idx" on "chess_coaching_assignments" ("createdAt" desc);

create table if not exists "chess_coaching_calendar_entries" (
  id text primary key
,  "sessionId" text
,  "coachId" text
,  "studentIds" jsonb
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "venueType" text
,  "createdAt" timestamptz
);
create index if not exists "chess_coaching_calendar_entries_created_idx" on "chess_coaching_calendar_entries" ("createdAt" desc);

create table if not exists "chess_coaching_notes" (
  id text primary key
,  "sessionId" text
,  "coachId" text
,  "studentIds" jsonb
,  "text" text
,  "nextSteps" text
,  "visibility" text
,  "createdAt" timestamptz
);
create index if not exists "chess_coaching_notes_created_idx" on "chess_coaching_notes" ("createdAt" desc);

create table if not exists "chess_coaching_notifications" (
  id text primary key
,  "sessionId" text
,  "job" text
,  "recipients" jsonb
,  "status" text
,  "createdAt" timestamptz
);
create index if not exists "chess_coaching_notifications_created_idx" on "chess_coaching_notifications" ("createdAt" desc);

create table if not exists "chess_coaching_offerings" (
  id text primary key
,  "title" text
,  "type" text
,  "coachId" text
,  "capacity" numeric
,  "venueType" text
,  "venue" text
,  "meetingLink" text
,  "meetingIntegration" text
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_coaching_offerings_created_idx" on "chess_coaching_offerings" ("createdAt" desc);

create table if not exists "chess_coaching_sessions" (
  id text primary key
,  "offeringId" text
,  "coachId" text
,  "studentIds" jsonb
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "venueType" text
,  "venue" text
,  "meetingLink" text
,  "status" text
,  "requestedBy" text
,  "confirmedBy" text
,  "completedAt" timestamptz
,  "participation" jsonb
,  "createdAt" timestamptz
,  "confirmedAt" timestamptz
);
create index if not exists "chess_coaching_sessions_created_idx" on "chess_coaching_sessions" ("createdAt" desc);

create table if not exists "chess_command_snapshots" (
  id text primary key
,  "generatedAt" timestamptz
,  "actorId" text
,  "summary" jsonb
,  "degradedTables" jsonb
,  "createdAt" timestamptz
);
create index if not exists "chess_command_snapshots_created_idx" on "chess_command_snapshots" ("createdAt" desc);

create table if not exists "chess_commentary_assignments" (
  id text primary key
,  "matchId" text
,  "userId" text
,  "displayName" text
,  "assignedBy" text
,  "status" text
,  "createdAt" timestamptz
);
create index if not exists "chess_commentary_assignments_created_idx" on "chess_commentary_assignments" ("createdAt" desc);

create table if not exists "chess_commentary_edits" (
  id text primary key
,  "entryId" text
,  "matchId" text
,  "revision" numeric
,  "previousText" text
,  "newText" text
,  "editedBy" text
,  "editedAt" timestamptz
);
create index if not exists "chess_commentary_edits_created_idx" on "chess_commentary_edits" ("createdAt" desc);

create table if not exists "chess_commentary_entries" (
  id text primary key
,  "matchId" text
,  "seq" numeric
,  "text" text
,  "kind" text
,  "moveNumber" numeric
,  "authorId" text
,  "authorDisplayName" text
,  "revision" numeric
,  "status" text
,  "editedAt" timestamptz
,  "deletedAt" timestamptz
,  "deletedBy" text
,  "createdAt" timestamptz
,  "editedBy" text
);
create index if not exists "chess_commentary_entries_created_idx" on "chess_commentary_entries" ("createdAt" desc);

create table if not exists "chess_commentary_settings" (
  id text primary key
,  "matchId" text
,  "delaySeconds" numeric
,  "updatedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_commentary_settings_created_idx" on "chess_commentary_settings" ("createdAt" desc);

create table if not exists "chess_community_blocks" (
  id text primary key
,  "blockerId" text
,  "blockedId" text
,  "createdAt" timestamptz
);
create index if not exists "chess_community_blocks_created_idx" on "chess_community_blocks" ("createdAt" desc);

create table if not exists "chess_community_comments" (
  id text primary key
,  "postId" text
,  "authorId" text
,  "body" text
,  "moderationState" text
,  "moderatedBy" text
,  "moderationReason" text
,  "moderatedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_community_comments_created_idx" on "chess_community_comments" ("createdAt" desc);

create table if not exists "chess_community_posts" (
  id text primary key
,  "authorId" text
,  "title" text
,  "body" text
,  "scope" text
,  "isPublic" boolean
,  "moderationState" text
,  "moderatedBy" text
,  "moderationReason" text
,  "moderatedAt" timestamptz
,  "commentCount" numeric
,  "createdAt" timestamptz
);
create index if not exists "chess_community_posts_created_idx" on "chess_community_posts" ("createdAt" desc);

create table if not exists "chess_community_reports" (
  id text primary key
,  "reporterId" text
,  "targetType" text
,  "targetId" text
,  "reason" text
,  "status" text
,  "verified" boolean
,  "resolvedBy" text
,  "resolutionReason" text
,  "outcome" text
,  "resolvedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_community_reports_created_idx" on "chess_community_reports" ("createdAt" desc);

create table if not exists "chess_compliance_consents" (
  id text primary key
,  "subjectId" text
,  "purpose" text
,  "basis" text
,  "status" text
,  "granted" boolean
,  "policyVersion" text
,  "grantedAt" timestamptz
,  "withdrawnAt" timestamptz
,  "recordedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_compliance_consents_created_idx" on "chess_compliance_consents" ("createdAt" desc);

create table if not exists "chess_compliance_data_requests" (
  id text primary key
,  "subjectId" text
,  "type" text
,  "status" text
,  "raisedBy" text
,  "details" text
,  "dueAt" timestamptz
,  "receivedAt" timestamptz
,  "completedAt" timestamptz
,  "decision" text
,  "decisionReason" text
,  "legalHold" boolean
,  "history" jsonb
,  "createdAt" timestamptz
,  "decidedBy" text
,  "decidedAt" timestamptz
,  "legalHoldReason" text
);
create index if not exists "chess_compliance_data_requests_created_idx" on "chess_compliance_data_requests" ("createdAt" desc);

create table if not exists "chess_compliance_policies" (
  id text primary key
,  "key" text
,  "title" text
,  "version" numeric
,  "ownerId" text
,  "effectiveDate" timestamptz
,  "reviewDueAt" timestamptz
,  "status" text
,  "reviewedBy" text
,  "publishedAt" timestamptz
,  "complianceClaimed" boolean
,  "notes" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_compliance_policies_created_idx" on "chess_compliance_policies" ("createdAt" desc);

create table if not exists "chess_compliance_privacy_incidents" (
  id text primary key
,  "title" text
,  "severity" text
,  "description" text
,  "personalDataInvolved" boolean
,  "status" text
,  "escalationLevel" numeric
,  "escalatedTo" text
,  "reportedBy" text
,  "reportedAt" timestamptz
,  "createdAt" timestamptz
,  "escalatedAt" timestamptz
);
create index if not exists "chess_compliance_privacy_incidents_created_idx" on "chess_compliance_privacy_incidents" ("createdAt" desc);

create table if not exists "chess_compliance_retention_rules" (
  id text primary key
,  "dataCategory" text
,  "retentionMonths" numeric
,  "basis" text
,  "reviewedBy" text
,  "reviewDueAt" timestamptz
,  "status" text
,  "createdAt" timestamptz
);
create index if not exists "chess_compliance_retention_rules_created_idx" on "chess_compliance_retention_rules" ("createdAt" desc);

create table if not exists "chess_data_backup_jobs" (
  id text primary key
,  "scope" text
,  "target" text
,  "process" text
,  "status" text
,  "checksum" text
,  "sizeBytes" numeric
,  "encrypted" boolean
,  "storageRef" text
,  "integrityVerified" boolean
,  "integrityVerifiedAt" timestamptz
,  "restoreVerified" boolean
,  "restoreVerifiedAt" timestamptz
,  "valid" boolean
,  "failureReason" text
,  "note" text
,  "createdBy" text
,  "createdAt" timestamptz
,  "completedAt" timestamptz
,  "integrityVerifiedBy" text
,  "restoreVerifiedBy" text
,  "restoreEnvironment" text
);
create index if not exists "chess_data_backup_jobs_created_idx" on "chess_data_backup_jobs" ("createdAt" desc);

create table if not exists "chess_data_export_requests" (
  id text primary key
,  "scope" text
,  "format" text
,  "containsSensitive" boolean
,  "requestedBy" text
,  "status" text
,  "rowLimit" numeric
,  "createdAt" timestamptz
);
create index if not exists "chess_data_export_requests_created_idx" on "chess_data_export_requests" ("createdAt" desc);

create table if not exists "chess_data_import_batches" (
  id text primary key
,  "target" text
,  "table" text
,  "keyField" text
,  "total" numeric
,  "validCount" numeric
,  "invalidCount" numeric
,  "conflictCount" numeric
,  "valid" jsonb
,  "invalid" jsonb
,  "conflicts" jsonb
,  "status" text
,  "requiresConfirmation" boolean
,  "previewedBy" text
,  "createdAt" timestamptz
,  "committedCount" numeric
,  "committedAt" timestamptz
,  "committedBy" text
,  "overwriteAuthorised" boolean
);
create index if not exists "chess_data_import_batches_created_idx" on "chess_data_import_batches" ("createdAt" desc);

create table if not exists "chess_data_restore_requests" (
  id text primary key
,  "backupId" text
,  "reason" text
,  "requestedBy" text
,  "status" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "executedAt" timestamptz
,  "idempotencyKey" text
,  "createdAt" timestamptz
,  "approvalNote" text
,  "executedBy" text
,  "suppressedDuplicateActions" jsonb
);
create index if not exists "chess_data_restore_requests_created_idx" on "chess_data_restore_requests" ("createdAt" desc);

create table if not exists "chess_domain_allowlist" (
  id text primary key
,  "domain" text
,  "applicantType" text
,  "active" boolean
,  "addedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_domain_allowlist_created_idx" on "chess_domain_allowlist" ("createdAt" desc);

create table if not exists "chess_event_registrations" (
  id text primary key
,  "eventId" text
,  "userId" text
,  "status" text
,  "waitlistPosition" numeric
,  "addedManually" boolean
,  "registeredBy" text
,  "registeredAt" timestamptz
,  "withdrawnAt" timestamptz
,  "withdrawnReason" text
,  "promotedAt" timestamptz
,  "decidedBy" text
,  "decidedAt" timestamptz
);
create index if not exists "chess_event_registrations_created_idx" on "chess_event_registrations" ("createdAt" desc);

create table if not exists "chess_events" (
  id text primary key
,  "title" text
,  "description" text
,  "status" text
,  "createdAt" timestamptz
);
create index if not exists "chess_events_created_idx" on "chess_events" ("createdAt" desc);

create table if not exists "chess_experience_feedback" (
  id text primary key
,  "type" text
,  "title" text
,  "description" text
,  "severity" text
,  "page" text
,  "context" text
,  "submittedBy" text
,  "queue" text
,  "visibility" text
,  "publicVotable" boolean
,  "securitySensitive" boolean
,  "status" text
,  "priority" text
,  "assignedTo" text
,  "duplicateOf" text
,  "roadmapPublished" boolean
,  "triageHistory" jsonb
,  "createdAt" timestamptz
,  "triagedBy" text
,  "triagedAt" timestamptz
,  "resolvedAt" timestamptz
,  "publicApproved" boolean
,  "approvedBy" text
,  "publicTitle" text
,  "promisedDate" timestamptz
,  "roadmapPublishedAt" timestamptz
);
create index if not exists "chess_experience_feedback_created_idx" on "chess_experience_feedback" ("createdAt" desc);

create table if not exists "chess_experience_votes" (
  id text primary key
,  "feedbackId" text
,  "userId" text
,  "createdAt" timestamptz
);
create index if not exists "chess_experience_votes_created_idx" on "chess_experience_votes" ("createdAt" desc);

create table if not exists "chess_facility_bookings" (
  id text primary key
,  "venueId" text
,  "requestedBy" text
,  "purpose" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "attendees" numeric
,  "status" text
,  "approvedBy" text
,  "decidedAt" timestamptz
,  "cancelledBy" text
,  "cancelReason" text
,  "createdAt" timestamptz
,  "cancelledAt" timestamptz
);
create index if not exists "chess_facility_bookings_created_idx" on "chess_facility_bookings" ("createdAt" desc);

create table if not exists "chess_facility_maintenance" (
  id text primary key
,  "venueId" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "note" text
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_facility_maintenance_created_idx" on "chess_facility_maintenance" ("createdAt" desc);

create table if not exists "chess_facility_venues" (
  id text primary key
,  "name" text
,  "building" text
,  "room" text
,  "capacity" numeric
,  "boardCount" numeric
,  "layout" jsonb
,  "accessibility" text
,  "safetyNotes" text
,  "status" text
,  "managerId" text
,  "createdAt" timestamptz
);
create index if not exists "chess_facility_venues_created_idx" on "chess_facility_venues" ("createdAt" desc);

create table if not exists "chess_finance_contributions" (
  id text primary key
,  "source" text
,  "kind" text
,  "amountPaise" numeric
,  "reference" text
,  "receivedAt" timestamptz
,  "status" text
,  "recordedBy" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "createdAt" timestamptz
,  "ledgerGroupId" text
);
create index if not exists "chess_finance_contributions_created_idx" on "chess_finance_contributions" ("createdAt" desc);

create table if not exists "chess_finance_expenses" (
  id text primary key
,  "description" text
,  "amountPaise" numeric
,  "category" text
,  "payee" text
,  "budgetId" text
,  "receiptFileId" text
,  "receiptStorage" text
,  "status" text
,  "requestedBy" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "rejectedBy" text
,  "rejectedAt" timestamptz
,  "ledgerGroupId" text
,  "createdAt" timestamptz
);
create index if not exists "chess_finance_expenses_created_idx" on "chess_finance_expenses" ("createdAt" desc);

create table if not exists "chess_finance_ledger_entries" (
  id text primary key
,  "groupId" text
,  "kind" text
,  "account" text
,  "debitPaise" numeric
,  "creditPaise" numeric
,  "amountPaise" numeric
,  "description" text
,  "refType" text
,  "refId" text
,  "postedBy" text
,  "postedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_finance_ledger_entries_created_idx" on "chess_finance_ledger_entries" ("createdAt" desc);

create table if not exists "chess_finance_periods" (
  id text primary key
,  "label" text
,  "endsAt" timestamptz
,  "incomePaise" numeric
,  "expensePaise" numeric
,  "balancePaise" numeric
,  "entryCount" numeric
,  "status" text
,  "closedBy" text
,  "closedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_finance_periods_created_idx" on "chess_finance_periods" ("createdAt" desc);

create table if not exists "chess_format_configs" (
  id text primary key
,  "tournamentId" text
,  "format" text
,  "rounds" numeric
,  "participantIds" jsonb
,  "teams" jsonb
,  "tieBreakers" jsonb
,  "timeControl" jsonb
,  "networkMode" text
,  "blockedMode" jsonb
,  "spectators" jsonb
,  "status" text
,  "locked" boolean
,  "lockedAt" timestamptz
,  "firstOfficialMatchId" text
,  "validatedAt" timestamptz
,  "createdBy" text
,  "resetAt" timestamptz
);
create index if not exists "chess_format_configs_created_idx" on "chess_format_configs" ("createdAt" desc);

create table if not exists "chess_format_pairings" (
  id text primary key
,  "configId" text
,  "tournamentId" text
,  "round" numeric
,  "board" numeric
,  "whiteId" text
,  "blackId" text
,  "bye" boolean
,  "result" text
,  "resultSource" text
);
create index if not exists "chess_format_pairings_created_idx" on "chess_format_pairings" ("createdAt" desc);

create table if not exists "chess_format_resets" (
  id text primary key
,  "configId" text
,  "tournamentId" text
,  "reason" text
,  "requestedBy" text
,  "requestedAt" timestamptz
,  "status" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "note" text
);
create index if not exists "chess_format_resets_created_idx" on "chess_format_resets" ("createdAt" desc);

create table if not exists "chess_format_signals" (
  id text primary key
,  "matchId" text
,  "configId" text
,  "type" text
,  "detail" jsonb
,  "severity" text
,  "status" text
,  "organizerAlerted" boolean
,  "isProofOfCheating" boolean
,  "automaticPenalty" boolean
,  "penaltyId" text
,  "recordedBy" text
,  "at" text
,  "decision" text
,  "decisionReason" text
,  "decidedBy" text
,  "decidedAt" timestamptz
);
create index if not exists "chess_format_signals_created_idx" on "chess_format_signals" ("createdAt" desc);

create table if not exists "chess_format_spectators" (
  id text primary key
,  "matchId" text
,  "configId" text
,  "spectatorId" text
,  "requestedBy" text
,  "status" text
,  "readOnly" boolean
,  "delaySeconds" numeric
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "revokedBy" text
,  "revokedAt" timestamptz
,  "revokeReason" text
);
create index if not exists "chess_format_spectators_created_idx" on "chess_format_spectators" ("createdAt" desc);

create table if not exists "chess_governance_candidates" (
  id text primary key
,  "electionId" text
,  "userId" text
,  "position" text
,  "statement" text
,  "proposedBy" text
,  "status" text
,  "eligibilityNotes" text
,  "reviewedBy" text
,  "reviewedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_governance_candidates_created_idx" on "chess_governance_candidates" ("createdAt" desc);

create table if not exists "chess_governance_elections" (
  id text primary key
,  "title" text
,  "positions" jsonb
,  "opensAt" timestamptz
,  "closesAt" timestamptz
,  "requiresInstitutionalApproval" boolean
,  "authorized" boolean
,  "authorizedBy" text
,  "authorizedAt" timestamptz
,  "authorizationRef" text
,  "status" text
,  "results" jsonb
,  "certified" boolean
,  "certifiedBy" text
,  "certifiedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
,  "votingOpenedAt" timestamptz
,  "votingOpenedBy" text
,  "closedAt" timestamptz
,  "closedBy" text
,  "certificationNotes" text
);
create index if not exists "chess_governance_elections_created_idx" on "chess_governance_elections" ("createdAt" desc);

create table if not exists "chess_governance_handover_tasks" (
  id text primary key
,  "electionId" text
,  "title" text
,  "asset" text
,  "assigneeId" text
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
,  "completedAt" timestamptz
,  "completedBy" text
);
create index if not exists "chess_governance_handover_tasks_created_idx" on "chess_governance_handover_tasks" ("createdAt" desc);

create table if not exists "chess_governance_terms" (
  id text primary key
,  "position" text
,  "userId" text
,  "holderName" text
,  "responsibilities" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_governance_terms_created_idx" on "chess_governance_terms" ("createdAt" desc);

create table if not exists "chess_governance_votes" (
  id text primary key
,  "electionId" text
,  "voterId" text
,  "candidateId" text
,  "castAt" timestamptz
,  "ballotHash" text
);
create index if not exists "chess_governance_votes_created_idx" on "chess_governance_votes" ("createdAt" desc);

create table if not exists "chess_integration_health_checks" (
  id text primary key
,  "integrationId" text
,  "status" text
,  "latencyMs" numeric
,  "checkedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_integration_health_checks_created_idx" on "chess_integration_health_checks" ("createdAt" desc);

create table if not exists "chess_integration_registry" (
  id text primary key
,  "provider" text
,  "category" text
,  "purpose" text
,  "ownerId" text
,  "dataScope" jsonb
,  "credentialRef" text
,  "permissionScopes" jsonb
,  "freeQuotaLimit" numeric
,  "quotaUnit" text
,  "currencyBudgetInr" text
,  "usageCount" numeric
,  "enabled" boolean
,  "healthStatus" text
,  "failurePolicy" text
,  "migrationPath" text
,  "termsReviewed" boolean
,  "termsReviewedBy" text
,  "termsReviewedAt" timestamptz
,  "lastVerifiedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
,  "enabledAt" timestamptz
,  "disabledAt" timestamptz
,  "lastUsedAt" timestamptz
,  "lastError" text
);
create index if not exists "chess_integration_registry_created_idx" on "chess_integration_registry" ("createdAt" desc);

create table if not exists "chess_integration_usage_events" (
  id text primary key
,  "integrationId" text
,  "provider" text
,  "units" numeric
,  "kind" text
,  "actorId" text
,  "createdAt" timestamptz
);
create index if not exists "chess_integration_usage_events_created_idx" on "chess_integration_usage_events" ("createdAt" desc);

create table if not exists "chess_interuniversity_competitions" (
  id text primary key
,  "name" text
,  "federationId" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "eligibility" text
,  "selectionCriteria" text
,  "externalUrl" text
,  "registrationStatus" text
,  "paymentProcessed" boolean
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_interuniversity_competitions_created_idx" on "chess_interuniversity_competitions" ("createdAt" desc);

create table if not exists "chess_interuniversity_documents" (
  id text primary key
,  "competitionId" text
,  "title" text
,  "url" text
,  "kind" text
,  "restrictedTo" jsonb
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_interuniversity_documents_created_idx" on "chess_interuniversity_documents" ("createdAt" desc);

create table if not exists "chess_interuniversity_federations" (
  id text primary key
,  "name" text
,  "contactName" text
,  "contactEmail" text
,  "website" text
,  "verified" boolean
,  "verifiedBy" text
,  "verifiedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_interuniversity_federations_created_idx" on "chess_interuniversity_federations" ("createdAt" desc);

create table if not exists "chess_interuniversity_fixtures" (
  id text primary key
,  "competitionId" text
,  "federationId" text
,  "round" numeric
,  "opponentUniversity" text
,  "homeAway" text
,  "scheduledAt" timestamptz
,  "venue" text
,  "result" text
,  "ourScore" numeric
,  "opponentScore" numeric
,  "resultStatus" text
,  "proposedBy" text
,  "proposedAt" timestamptz
,  "confirmedBy" text
,  "confirmedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_interuniversity_fixtures_created_idx" on "chess_interuniversity_fixtures" ("createdAt" desc);

create table if not exists "chess_interuniversity_teams" (
  id text primary key
,  "competitionId" text
,  "playerIds" jsonb
,  "criteria" text
,  "status" text
,  "proposedBy" text
,  "proposedAt" timestamptz
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_interuniversity_teams_created_idx" on "chess_interuniversity_teams" ("createdAt" desc);

create table if not exists "chess_inventory_assets" (
  id text primary key
,  "assetTag" text
,  "name" text
,  "category" text
,  "description" text
,  "source" text
,  "acquiredAt" timestamptz
,  "condition" text
,  "location" text
,  "custodianId" text
,  "quantity" numeric
,  "onLoan" numeric
,  "damaged" numeric
,  "lost" numeric
,  "replacementValue" numeric
,  "warrantyUntil" text
,  "attachments" jsonb
,  "status" text
,  "disposalStatus" text
,  "disposalRequestedBy" text
,  "disposalReason" text
,  "disposalApprovedBy" text
,  "disposedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
,  "disposalRequestedAt" timestamptz
);
create index if not exists "chess_inventory_assets_created_idx" on "chess_inventory_assets" ("createdAt" desc);

create table if not exists "chess_inventory_loans" (
  id text primary key
,  "assetId" text
,  "borrowerId" text
,  "quantity" numeric
,  "returnedQuantity" numeric
,  "dueAt" timestamptz
,  "status" text
,  "checkedOutAt" timestamptz
,  "checkedOutBy" text
,  "returnedAt" timestamptz
,  "returnedBy" text
,  "returnCondition" text
);
create index if not exists "chess_inventory_loans_created_idx" on "chess_inventory_loans" ("createdAt" desc);

create table if not exists "chess_inventory_movements" (
  id text primary key
,  "assetId" text
,  "kind" text
,  "quantity" numeric
,  "actorId" text
,  "at" text
,  "condition" text
,  "note" text
,  "borrowerId" text
);
create index if not exists "chess_inventory_movements_created_idx" on "chess_inventory_movements" ("createdAt" desc);

create table if not exists "chess_kb_articles" (
  id text primary key
,  "title" text
,  "body" text
,  "status" text
,  "createdAt" timestamptz
,  "slug" text
,  "summary" text
,  "category" text
,  "tags" jsonb
,  "audience" text
,  "visibility" text
,  "isPolicy" boolean
,  "external" boolean
,  "source" text
,  "licence" text
,  "ownerId" text
,  "version" numeric
,  "reviewDueAt" timestamptz
,  "publishedAt" timestamptz
,  "publishedBy" text
,  "archivedAt" timestamptz
,  "lastEditedBy" text
,  "lastEditedAt" timestamptz
);
create index if not exists "chess_kb_articles_created_idx" on "chess_kb_articles" ("createdAt" desc);

create table if not exists "chess_kb_versions" (
  id text primary key
,  "articleId" text
,  "version" numeric
,  "title" text
,  "body" text
,  "summary" text
,  "audience" text
,  "visibility" text
,  "status" text
,  "savedBy" text
,  "savedAt" timestamptz
);
create index if not exists "chess_kb_versions_created_idx" on "chess_kb_versions" ("createdAt" desc);

create table if not exists "chess_marketing_campaigns" (
  id text primary key
,  "title" text
,  "channel" text
,  "scheduledAt" timestamptz
,  "brief" text
,  "content" text
,  "assetUrls" jsonb
,  "identifiablePeople" boolean
,  "consentGranted" boolean
,  "consentEvidence" text
,  "audience" text
,  "transactional" boolean
,  "status" text
,  "externalUrl" text
,  "publishedAt" timestamptz
,  "publishedBy" text
,  "approvedBy" text
,  "rejectedReason" text
,  "metrics" jsonb
,  "createdBy" text
,  "submittedAt" timestamptz
,  "approvedAt" timestamptz
);
create index if not exists "chess_marketing_campaigns_created_idx" on "chess_marketing_campaigns" ("createdAt" desc);

create table if not exists "chess_match_confirmations" (
  id text primary key
,  "matchId" text
,  "playerId" text
,  "side" text
,  "decision" text
,  "note" text
,  "at" text
);
create index if not exists "chess_match_confirmations_created_idx" on "chess_match_confirmations" ("createdAt" desc);

create table if not exists "chess_match_disputes" (
  id text primary key
,  "matchId" text
,  "raisedBy" text
,  "side" text
,  "reason" text
,  "status" text
,  "resolution" text
,  "resolvedBy" text
,  "resolvedAt" timestamptz
,  "at" text
);
create index if not exists "chess_match_disputes_created_idx" on "chess_match_disputes" ("createdAt" desc);

create table if not exists "chess_match_events" (
  id text primary key
,  "matchId" text
,  "action" text
,  "actorId" text
,  "detail" jsonb
,  "at" text
);
create index if not exists "chess_match_events_created_idx" on "chess_match_events" ("createdAt" desc);

create table if not exists "chess_match_moves" (
  id text primary key
,  "matchId" text
,  "seq" numeric
,  "side" text
,  "playerId" text
,  "san" text
,  "from" text
,  "to" text
,  "promotion" text
,  "clockAfterMs" numeric
,  "at" text
);
create index if not exists "chess_match_moves_created_idx" on "chess_match_moves" ("createdAt" desc);

create table if not exists "chess_match_rooms" (
  id text primary key
,  "tournamentId" text
,  "whitePlayerId" text
,  "blackPlayerId" text
,  "round" numeric
,  "board" text
,  "timeControl" jsonb
,  "clock" jsonb
,  "status" text
,  "turn" text
,  "seq" numeric
,  "version" numeric
,  "checkedIn" jsonb
,  "lastMoveAt" timestamptz
,  "startedAt" timestamptz
,  "endedAt" timestamptz
,  "proposedResult" jsonb
,  "finalResult" text
,  "confirmedAt" timestamptz
,  "finalizedAt" timestamptz
,  "resolvedBy" text
,  "drawOffer" text
,  "clockExpired" boolean
,  "affectsRating" boolean
,  "ratingPipelineStatus" text
,  "spectatorEnabled" boolean
,  "spectatorDelaySeconds" numeric
,  "createdBy" text
,  "readyAt" timestamptz
,  "resolutionReason" text
,  "standingsUpdated" boolean
,  "disputedAt" timestamptz
,  "pausedAt" timestamptz
,  "pauseReason" text
,  "resumedAt" timestamptz
);
create index if not exists "chess_match_rooms_created_idx" on "chess_match_rooms" ("createdAt" desc);

create table if not exists "chess_match_standings" (
  id text primary key
,  "tournamentId" text
,  "playerId" text
,  "points" numeric
,  "played" numeric
,  "wins" numeric
,  "draws" numeric
,  "losses" numeric
,  "lastMatchId" text
);
create index if not exists "chess_match_standings_created_idx" on "chess_match_standings" ("createdAt" desc);

create table if not exists "chess_media_items" (
  id text primary key
,  "title" text
,  "caption" text
,  "status" text
,  "archiveYear" numeric
,  "tags" jsonb
,  "createdAt" timestamptz
,  "albumId" text
,  "eventDate" timestamptz
,  "sourceOwner" text
,  "licence" text
,  "sourceUrl" text
,  "mediaType" text
,  "externalUrl" text
,  "identifiablePeople" boolean
,  "consentStatus" text
,  "consentRecordedAt" timestamptz
,  "storageBytes" numeric
,  "downloadRestricted" boolean
,  "publishedAt" timestamptz
,  "moderationNote" text
,  "contributorId" text
,  "consentEvidence" text
,  "consentRecordedBy" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "publishedBy" text
,  "removedAt" timestamptz
,  "removedBy" text
,  "removalReason" text
);
create index if not exists "chess_media_items_created_idx" on "chess_media_items" ("createdAt" desc);

create table if not exists "chess_media_takedown_requests" (
  id text primary key
,  "mediaId" text
,  "requesterId" text
,  "reason" text
,  "contact" text
,  "status" text
,  "raisedAt" timestamptz
,  "resolvedBy" text
,  "resolvedAt" timestamptz
);
create index if not exists "chess_media_takedown_requests_created_idx" on "chess_media_takedown_requests" ("createdAt" desc);

create table if not exists "chess_membership_applications" (
  id text primary key
,  "applicantId" text
,  "applicantType" text
,  "categoryCode" text
,  "mode" text
,  "email" text
,  "status" text
,  "eligibilityStatus" text
,  "eligibilityReason" text
,  "termsAcceptedAt" timestamptz
,  "submittedAt" timestamptz
,  "decidedBy" text
,  "decidedAt" timestamptz
,  "decisionReason" text
,  "infoRequestedReason" text
,  "effectiveFrom" text
,  "effectiveTo" text
,  "createdAt" timestamptz
);
create index if not exists "chess_membership_applications_created_idx" on "chess_membership_applications" ("createdAt" desc);

create table if not exists "chess_membership_categories" (
  id text primary key
,  "code" text
,  "name" text
,  "mode" text
,  "active" boolean
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_membership_categories_created_idx" on "chess_membership_categories" ("createdAt" desc);

create table if not exists "chess_notice_versions" (
  id text primary key
,  "noticeId" text
,  "version" numeric
,  "title" text
,  "body" text
,  "category" text
,  "audience" jsonb
,  "priority" text
,  "reason" text
,  "recordedBy" text
,  "recordedAt" timestamptz
);
create index if not exists "chess_notice_versions_created_idx" on "chess_notice_versions" ("createdAt" desc);

create table if not exists "chess_notices" (
  id text primary key
,  "title" text
,  "body" text
,  "status" text
,  "visibility" text
,  "createdAt" timestamptz
,  "category" text
,  "audience" jsonb
,  "priority" text
,  "pinned" boolean
,  "publishAt" timestamptz
,  "expiresAt" timestamptz
,  "requiresApproval" boolean
,  "version" numeric
,  "createdBy" text
,  "submittedAt" timestamptz
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "publishedBy" text
,  "publishedAt" timestamptz
,  "archivedAt" timestamptz
,  "correctedAt" timestamptz
,  "correctedBy" text
,  "correctionReason" text
,  "unpublishedAt" timestamptz
,  "unpublishReason" text
);
create index if not exists "chess_notices_created_idx" on "chess_notices" ("createdAt" desc);

create table if not exists "chess_ops_alert_config" (
  id text primary key
,  "key" text
,  "value" jsonb
,  "updatedBy" text
,  "updatedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_ops_alert_config_created_idx" on "chess_ops_alert_config" ("createdAt" desc);

create table if not exists "chess_ops_alerts" (
  id text primary key
,  "category" text
,  "severity" text
,  "title" text
,  "detail" text
,  "ownerRole" text
,  "sensitive" boolean
,  "dedupeKey" text
,  "escalationPath" jsonb
,  "escalationLevel" numeric
,  "escalatedTo" text
,  "escalatedAt" timestamptz
,  "ackDueAt" timestamptz
,  "acknowledgedBy" text
,  "acknowledgedAt" timestamptz
,  "status" text
,  "occurrenceCount" numeric
,  "lastSeenAt" timestamptz
,  "resolvedBy" text
,  "resolvedAt" timestamptz
,  "resolutionNote" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_ops_alerts_created_idx" on "chess_ops_alerts" ("createdAt" desc);

create table if not exists "chess_ops_task_dependencies" (
  id text primary key
,  "taskId" text
,  "dependsOnId" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_ops_task_dependencies_created_idx" on "chess_ops_task_dependencies" ("createdAt" desc);

create table if not exists "chess_ops_task_events" (
  id text primary key
,  "taskId" text
,  "from" text
,  "to" text
,  "actorId" text
,  "note" text
,  "at" text
);
create index if not exists "chess_ops_task_events_created_idx" on "chess_ops_task_events" ("createdAt" desc);

create table if not exists "chess_ops_tasks" (
  id text primary key
,  "title" text
,  "assigneeId" text
,  "status" text
,  "priority" text
,  "dueDate" timestamptz
,  "createdAt" timestamptz
,  "description" text
,  "scope" text
,  "projectId" text
,  "sensitive" boolean
,  "checklist" jsonb
,  "evidence" text
,  "submittedAt" timestamptz
,  "closedAt" timestamptz
,  "reviewedBy" text
,  "createdBy" text
,  "reviewNote" text
);
create index if not exists "chess_ops_tasks_created_idx" on "chess_ops_tasks" ("createdAt" desc);

create table if not exists "chess_player_profiles" (
  id text primary key
,  "userId" text
,  "displayName" text
,  "clubId" text
,  "contactEmail" text
,  "department" text
,  "departmentVerified" boolean
,  "bulletRating" numeric
,  "blitzRating" numeric
,  "rapidRating" numeric
,  "bulletPeak" numeric
,  "blitzPeak" numeric
,  "rapidPeak" numeric
,  "bulletGames" numeric
,  "blitzGames" numeric
,  "rapidGames" numeric
,  "gamesPlayed" numeric
,  "wins" numeric
,  "draws" numeric
,  "losses" numeric
,  "membershipStatus" text
,  "hasOpenDispute" boolean
,  "privacy" jsonb
,  "achievements" jsonb
,  "certificates" jsonb
,  "tournamentHistory" jsonb
,  "createdAt" timestamptz
);
create index if not exists "chess_player_profiles_created_idx" on "chess_player_profiles" ("createdAt" desc);

create table if not exists "chess_qa_incidents" (
  id text primary key
,  "title" text
,  "severity" text
,  "detail" text
,  "status" text
,  "openedBy" text
,  "resolvedBy" text
,  "resolvedAt" timestamptz
,  "createdAt" timestamptz
,  "resolution" text
);
create index if not exists "chess_qa_incidents_created_idx" on "chess_qa_incidents" ("createdAt" desc);

create table if not exists "chess_qa_metrics" (
  id text primary key
,  "name" text
,  "value" numeric
,  "unit" text
,  "kind" text
,  "route" text
,  "recordedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_qa_metrics_created_idx" on "chess_qa_metrics" ("createdAt" desc);

create table if not exists "chess_qa_performance_budgets" (
  id text primary key
,  "flow" text
,  "p95Ms" numeric
,  "errorRatePct" numeric
,  "notes" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_qa_performance_budgets_created_idx" on "chess_qa_performance_budgets" ("createdAt" desc);

create table if not exists "chess_qa_release_gates" (
  id text primary key
,  "version" text
,  "status" text
,  "blockers" jsonb
,  "totalPassed" numeric
,  "totalFailed" numeric
,  "accessibilityViolations" numeric
,  "testRunIds" jsonb
,  "evaluatedBy" text
,  "createdAt" timestamptz
,  "releasedAt" timestamptz
);
create index if not exists "chess_qa_release_gates_created_idx" on "chess_qa_release_gates" ("createdAt" desc);

create table if not exists "chess_qa_test_runs" (
  id text primary key
,  "suite" text
,  "passed" numeric
,  "failed" numeric
,  "skipped" numeric
,  "total" numeric
,  "durationMs" numeric
,  "accessibility" jsonb
,  "devices" jsonb
,  "loadTest" boolean
,  "providerCompliant" boolean
,  "status" text
,  "runBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_qa_test_runs_created_idx" on "chess_qa_test_runs" ("createdAt" desc);

create table if not exists "chess_rated_results" (
  id text primary key
,  "sourceResultId" text
,  "pool" text
,  "whiteId" text
,  "blackId" text
,  "result" text
,  "kind" text
,  "tournamentId" text
,  "appliedBy" text
,  "appliedAt" timestamptz
);
create index if not exists "chess_rated_results_created_idx" on "chess_rated_results" ("createdAt" desc);

create table if not exists "chess_rating_corrections" (
  id text primary key
,  "userId" text
,  "pool" text
,  "before" numeric
,  "newRating" numeric
,  "reason" text
,  "requestedBy" text
,  "status" text
,  "createdAt" timestamptz
);
create index if not exists "chess_rating_corrections_created_idx" on "chess_rating_corrections" ("createdAt" desc);

create table if not exists "chess_rating_history" (
  id text primary key
,  "userId" text
,  "pool" text
,  "before" numeric
,  "after" numeric
,  "delta" numeric
,  "kind" text
,  "sourceResultId" text
,  "opponentId" text
,  "result" text
,  "at" text
,  "correctionId" text
,  "reason" text
,  "actorId" text
);
create index if not exists "chess_rating_history_created_idx" on "chess_rating_history" ("createdAt" desc);

create table if not exists "chess_recovery_contacts" (
  id text primary key
,  "role" text
,  "name" text
,  "contact" text
,  "backupName" text
,  "active" boolean
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_recovery_contacts_created_idx" on "chess_recovery_contacts" ("createdAt" desc);

create table if not exists "chess_recovery_continuity_events" (
  id text primary key
,  "tournamentId" text
,  "reason" text
,  "mode" text
,  "status" text
,  "preservedStateRef" text
,  "walkoverAwarded" boolean
,  "manualDecisionRecorded" boolean
,  "reconcileRequired" boolean
,  "pausedBy" text
,  "pausedAt" timestamptz
,  "createdAt" timestamptz
,  "reconciliationNote" text
,  "reconciledBy" text
,  "reconciledAt" timestamptz
);
create index if not exists "chess_recovery_continuity_events_created_idx" on "chess_recovery_continuity_events" ("createdAt" desc);

create table if not exists "chess_recovery_drills" (
  id text primary key
,  "planId" text
,  "outcome" text
,  "actualRtoMinutes" numeric
,  "actualRpoMinutes" numeric
,  "targetRtoMinutes" numeric
,  "targetRpoMinutes" numeric
,  "rtoBreached" boolean
,  "rpoBreached" boolean
,  "lessons" text
,  "improvements" jsonb
,  "improvementCount" numeric
,  "drilledBy" text
,  "drilledAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_recovery_drills_created_idx" on "chess_recovery_drills" ("createdAt" desc);

create table if not exists "chess_recovery_plans" (
  id text primary key
,  "name" text
,  "scope" text
,  "rpoMinutes" numeric
,  "rtoMinutes" numeric
,  "evidenceRef" text
,  "evidenceTestedAt" timestamptz
,  "priorities" jsonb
,  "status" text
,  "drillLog" jsonb
,  "lastDrillAt" timestamptz
,  "rtoBreached" boolean
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
,  "approvalNote" text
,  "lastActualRtoMinutes" numeric
);
create index if not exists "chess_recovery_plans_created_idx" on "chess_recovery_plans" ("createdAt" desc);

create table if not exists "chess_report_exports" (
  id text primary key
,  "reportKey" text
,  "requestedBy" text
,  "generatedAt" timestamptz
,  "status" text
,  "rowCount" numeric
,  "format" text
,  "limitations" jsonb
,  "createdAt" timestamptz
);
create index if not exists "chess_report_exports_created_idx" on "chess_report_exports" ("createdAt" desc);

create table if not exists "chess_search_queries" (
  id text primary key
,  "userId" text
,  "q" text
,  "resultCount" numeric
,  "createdAt" timestamptz
);
create index if not exists "chess_search_queries_created_idx" on "chess_search_queries" ("createdAt" desc);

create table if not exists "chess_season_points" (
  id text primary key
,  "seasonId" text
,  "userId" text
,  "resultId" text
,  "outcome" text
,  "points" numeric
,  "tournamentId" text
,  "recordedBy" text
,  "recordedAt" timestamptz
);
create index if not exists "chess_season_points_created_idx" on "chess_season_points" ("createdAt" desc);

create table if not exists "chess_season_rating_entries" (
  id text primary key
,  "seasonId" text
,  "userId" text
,  "pool" text
,  "startRating" numeric
,  "endRating" numeric
,  "games" numeric
,  "recordedBy" text
,  "recordedAt" timestamptz
);
create index if not exists "chess_season_rating_entries_created_idx" on "chess_season_rating_entries" ("createdAt" desc);

create table if not exists "chess_security_alerts" (
  id text primary key
,  "title" text
,  "signal" text
,  "severity" text
,  "ownerId" text
,  "status" text
,  "advisoryOnly" boolean
,  "conclusiveCheating" boolean
,  "requiresHumanReview" boolean
,  "raisedBy" text
,  "raisedAt" timestamptz
,  "createdAt" timestamptz
,  "escalatedAt" timestamptz
,  "incidentId" text
);
create index if not exists "chess_security_alerts_created_idx" on "chess_security_alerts" ("createdAt" desc);

create table if not exists "chess_security_blocked_users" (
  id text primary key
,  "ownerId" text
,  "blockedUserId" text
,  "createdAt" timestamptz
);
create index if not exists "chess_security_blocked_users_created_idx" on "chess_security_blocked_users" ("createdAt" desc);

create table if not exists "chess_security_events" (
  id text primary key
,  "userId" text
,  "type" text
,  "detail" jsonb
,  "createdAt" timestamptz
);
create index if not exists "chess_security_events_created_idx" on "chess_security_events" ("createdAt" desc);

create table if not exists "chess_security_incidents" (
  id text primary key
,  "title" text
,  "severity" text
,  "category" text
,  "ownerId" text
,  "status" text
,  "containmentStatus" text
,  "evidenceRefs" jsonb
,  "timeline" jsonb
,  "lessons" text
,  "detectedAt" timestamptz
,  "containedAt" timestamptz
,  "closedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
,  "sourceAlertId" text
,  "advisoryOnly" boolean
);
create index if not exists "chess_security_incidents_created_idx" on "chess_security_incidents" ("createdAt" desc);

create table if not exists "chess_security_login_attempts" (
  id text primary key
,  "email" text
,  "failures" numeric
,  "lockedUntil" text
,  "lastFailureAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_security_login_attempts_created_idx" on "chess_security_login_attempts" ("createdAt" desc);

create table if not exists "chess_security_mfa" (
  id text primary key
,  "userId" text
,  "enabled" boolean
,  "method" text
,  "enabledAt" timestamptz
,  "disabledAt" timestamptz
,  "recoveryCodesIssued" numeric
,  "createdAt" timestamptz
);
create index if not exists "chess_security_mfa_created_idx" on "chess_security_mfa" ("createdAt" desc);

create table if not exists "chess_security_privacy_settings" (
  id text primary key
,  "userId" text
,  "profileVisibility" text
,  "showEmail" boolean
,  "showRating" boolean
,  "showRealName" boolean
,  "allowDirectMessages" boolean
,  "consentMarketing" boolean
,  "consentAnalytics" boolean
,  "createdAt" timestamptz
,  "updatedAt" timestamptz
);
create index if not exists "chess_security_privacy_settings_created_idx" on "chess_security_privacy_settings" ("createdAt" desc);

create table if not exists "chess_security_privileged_reviews" (
  id text primary key
,  "accountId" text
,  "outcome" text
,  "notes" text
,  "reviewedBy" text
,  "reviewedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_security_privileged_reviews_created_idx" on "chess_security_privileged_reviews" ("createdAt" desc);

create table if not exists "chess_security_requests" (
  id text primary key
,  "userId" text
,  "type" text
,  "detail" text
,  "status" text
,  "reviewerId" text
,  "decidedAt" timestamptz
,  "note" text
,  "retentionReviewRequired" boolean
,  "createdAt" timestamptz
,  "handedToGovernance" boolean
);
create index if not exists "chess_security_requests_created_idx" on "chess_security_requests" ("createdAt" desc);

create table if not exists "chess_security_secret_rotations" (
  id text primary key
,  "name" text
,  "reason" text
,  "rotatedBy" text
,  "rotatedAt" timestamptz
,  "previousRotatedAt" timestamptz
,  "storedValue" text
,  "createdAt" timestamptz
);
create index if not exists "chess_security_secret_rotations_created_idx" on "chess_security_secret_rotations" ("createdAt" desc);

create table if not exists "chess_security_session_revocations" (
  id text primary key
,  "sessionId" text
,  "userId" text
,  "revokedBy" text
,  "revokedAt" timestamptz
,  "channels" jsonb
,  "createdAt" timestamptz
);
create index if not exists "chess_security_session_revocations_created_idx" on "chess_security_session_revocations" ("createdAt" desc);

create table if not exists "chess_security_vulnerabilities" (
  id text primary key
,  "component" text
,  "advisoryRef" text
,  "severity" text
,  "status" text
,  "ownerId" text
,  "remediationRef" text
,  "remediatedAt" timestamptz
,  "createdAt" timestamptz
,  "remediatedBy" text
);
create index if not exists "chess_security_vulnerabilities_created_idx" on "chess_security_vulnerabilities" ("createdAt" desc);

create table if not exists "chess_sessions" (
  id text primary key
,  "userId" text
,  "token" text
,  "expiresAt" timestamptz
,  "revokedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_sessions_created_idx" on "chess_sessions" ("createdAt" desc);

create table if not exists "chess_site_blocks" (
  id text primary key
,  "kind" text
,  "title" text
,  "summary" text
,  "body" text
,  "heroImageUrl" text
,  "links" jsonb
,  "contact" jsonb
,  "seo" jsonb
,  "internalNotes" text
,  "status" text
,  "version" numeric
,  "supersedesId" text
,  "authorId" text
,  "reviewerId" text
,  "approvedBy" text
,  "publishedAt" timestamptz
,  "archivedAt" timestamptz
,  "isFirstOfKind" boolean
,  "submittedAt" timestamptz
,  "approvedAt" timestamptz
,  "publishedBy" text
);
create index if not exists "chess_site_blocks_created_idx" on "chess_site_blocks" ("createdAt" desc);

create table if not exists "chess_sponsor_agreements" (
  id text primary key
,  "partnerId" text
,  "title" text
,  "committedAmount" numeric
,  "currency" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "terms" text
,  "status" text
,  "createdBy" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_sponsor_agreements_created_idx" on "chess_sponsor_agreements" ("createdAt" desc);

create table if not exists "chess_sponsor_contributions" (
  id text primary key
,  "partnerId" text
,  "agreementId" text
,  "amount" numeric
,  "currency" text
,  "receivedAt" timestamptz
,  "financeReference" text
,  "authoritativeSource" text
,  "recordedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_sponsor_contributions_created_idx" on "chess_sponsor_contributions" ("createdAt" desc);

create table if not exists "chess_sponsor_deliverables" (
  id text primary key
,  "agreementId" text
,  "partnerId" text
,  "title" text
,  "ownerId" text
,  "dueAt" timestamptz
,  "status" text
,  "completedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
,  "completedBy" text
);
create index if not exists "chess_sponsor_deliverables_created_idx" on "chess_sponsor_deliverables" ("createdAt" desc);

create table if not exists "chess_sponsor_partners" (
  id text primary key
,  "name" text
,  "type" text
,  "stage" text
,  "stageHistory" jsonb
,  "contactName" text
,  "contactEmail" text
,  "website" text
,  "logoUrl" text
,  "confidentialTerms" text
,  "recognitionStatus" text
,  "recognitionApproved" boolean
,  "recognitionPublished" boolean
,  "recognitionApprovedBy" text
,  "createdBy" text
,  "createdAt" timestamptz
,  "recognitionRequestedBy" text
,  "recognitionRequestedAt" timestamptz
,  "logoUseApproved" boolean
,  "recognitionApprovedAt" timestamptz
);
create index if not exists "chess_sponsor_partners_created_idx" on "chess_sponsor_partners" ("createdAt" desc);

create table if not exists "chess_strategy_key_results" (
  id text primary key
,  "objectiveId" text
,  "title" text
,  "target" numeric
,  "current" numeric
,  "unit" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_strategy_key_results_created_idx" on "chess_strategy_key_results" ("createdAt" desc);

create table if not exists "chess_strategy_milestones" (
  id text primary key
,  "objectiveId" text
,  "title" text
,  "dueDate" timestamptz
,  "ownerId" text
,  "status" text
,  "completedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_strategy_milestones_created_idx" on "chess_strategy_milestones" ("createdAt" desc);

create table if not exists "chess_strategy_objectives" (
  id text primary key
,  "title" text
,  "definition" text
,  "ownerId" text
,  "reviewDate" timestamptz
,  "status" text
,  "version" numeric
,  "publicSummary" text
,  "publicSummaryStatus" text
,  "publicSummaryAuthor" text
,  "publicSummaryApprovedBy" text
,  "archivedAt" timestamptz
,  "createdBy" text
,  "createdAt" timestamptz
,  "publicSummaryApprovedAt" timestamptz
);
create index if not exists "chess_strategy_objectives_created_idx" on "chess_strategy_objectives" ("createdAt" desc);

create table if not exists "chess_strategy_reviews" (
  id text primary key
,  "objectiveId" text
,  "scheduledFor" text
,  "heldAt" timestamptz
,  "decisions" jsonb
,  "attendees" jsonb
,  "notes" text
,  "recordedBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_strategy_reviews_created_idx" on "chess_strategy_reviews" ("createdAt" desc);

create table if not exists "chess_strategy_risks" (
  id text primary key
,  "objectiveId" text
,  "description" text
,  "likelihood" numeric
,  "impact" numeric
,  "severity" text
,  "mitigation" text
,  "ownerId" text
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_strategy_risks_created_idx" on "chess_strategy_risks" ("createdAt" desc);

create table if not exists "chess_support_ticket_notes" (
  id text primary key
,  "ticketId" text
,  "authorId" text
,  "body" text
,  "internal" boolean
,  "createdAt" timestamptz
);
create index if not exists "chess_support_ticket_notes_created_idx" on "chess_support_ticket_notes" ("createdAt" desc);

create table if not exists "chess_support_tickets" (
  id text primary key
,  "reference" text
,  "category" text
,  "subject" text
,  "body" text
,  "priority" text
,  "confidential" boolean
,  "queue" text
,  "status" text
,  "requesterId" text
,  "assigneeId" text
,  "relatedTo" text
,  "attachments" jsonb
,  "slaDueAt" timestamptz
,  "escalated" boolean
,  "escalationReason" text
,  "escalatedAt" timestamptz
,  "escalatedBy" text
,  "resolution" text
,  "resolvedAt" timestamptz
,  "closedAt" timestamptz
,  "acknowledgedAt" timestamptz
,  "reopenCount" numeric
,  "openedAt" timestamptz
,  "assignedBy" text
,  "assignedAt" timestamptz
,  "resolvedBy" text
,  "closedBy" text
,  "reopenReason" text
,  "reopenedAt" timestamptz
,  "escalatedTo" text
);
create index if not exists "chess_support_tickets_created_idx" on "chess_support_tickets" ("createdAt" desc);

create table if not exists "chess_survey_actions" (
  id text primary key
,  "pollId" text
,  "title" text
,  "ownerId" text
,  "dueAt" timestamptz
,  "status" text
,  "outcome" text
,  "createdBy" text
,  "createdAt" timestamptz
,  "completedAt" timestamptz
,  "completedBy" text
);
create index if not exists "chess_survey_actions_created_idx" on "chess_survey_actions" ("createdAt" desc);

create table if not exists "chess_survey_polls" (
  id text primary key
,  "title" text
,  "type" text
,  "selection" text
,  "maxSelections" numeric
,  "options" jsonb
,  "questions" jsonb
,  "purpose" text
,  "audience" text
,  "closesAt" timestamptz
,  "resultVisibility" text
,  "anonymous" boolean
,  "status" text
,  "officialElection" boolean
,  "voterSalt" text
,  "createdBy" text
,  "publishedAt" timestamptz
,  "closedAt" timestamptz
,  "createdAt" timestamptz
);
create index if not exists "chess_survey_polls_created_idx" on "chess_survey_polls" ("createdAt" desc);

create table if not exists "chess_survey_responses" (
  id text primary key
,  "pollId" text
,  "userId" text
,  "anonymous" boolean
,  "optionIds" jsonb
,  "comment" text
,  "createdAt" timestamptz
);
create index if not exists "chess_survey_responses_created_idx" on "chess_survey_responses" ("createdAt" desc);

create table if not exists "chess_survey_vote_ledger" (
  id text primary key
,  "pollId" text
,  "voterToken" text
,  "anonymous" boolean
,  "createdAt" timestamptz
);
create index if not exists "chess_survey_vote_ledger_created_idx" on "chess_survey_vote_ledger" ("createdAt" desc);

create table if not exists "chess_system_setting_history" (
  id text primary key
,  "key" text
,  "value" text
,  "version" numeric
,  "action" text
,  "actorId" text
,  "createdAt" timestamptz
);
create index if not exists "chess_system_setting_history_created_idx" on "chess_system_setting_history" ("createdAt" desc);

create table if not exists "chess_system_settings" (
  id text primary key
,  "key" text
,  "value" text
,  "version" numeric
,  "status" text
,  "updatedBy" text
,  "createdAt" timestamptz
,  "rolledBackFrom" text
,  "pendingValue" boolean
,  "pendingRequestedBy" text
,  "pendingRequestedAt" timestamptz
,  "pendingVersion" numeric
,  "pendingReason" text
,  "approvedBy" text
,  "approvedAt" timestamptz
);
create index if not exists "chess_system_settings_created_idx" on "chess_system_settings" ("createdAt" desc);

create table if not exists "chess_tournament_registrations" (
  id text primary key
,  "tournamentId" text
,  "playerId" text
,  "status" text
,  "createdAt" timestamptz
,  "waitlistPosition" numeric
,  "addedManually" boolean
,  "registeredBy" text
,  "registeredAt" timestamptz
,  "withdrawnAt" timestamptz
);
create index if not exists "chess_tournament_registrations_created_idx" on "chess_tournament_registrations" ("createdAt" desc);

create table if not exists "chess_tournaments" (
  id text primary key
,  "name" text
,  "status" text
,  "capacity" numeric
,  "createdAt" timestamptz
,  "description" text
,  "format" text
,  "rounds" numeric
,  "startsAt" timestamptz
,  "registrationOpensAt" timestamptz
,  "registrationClosesAt" timestamptz
,  "venue" text
,  "scheduleStatus" text
,  "scheduleProposedBy" text
,  "scheduleApprovedBy" text
,  "createdBy" text
,  "schedule" jsonb
,  "scheduleProposedAt" timestamptz
,  "scheduleApprovedAs" text
,  "scheduleApprovedAt" timestamptz
);
create index if not exists "chess_tournaments_created_idx" on "chess_tournaments" ("createdAt" desc);

create table if not exists "chess_travel_notices" (
  id text primary key
,  "tripId" text
,  "userId" text
,  "kind" text
,  "message" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_travel_notices_created_idx" on "chess_travel_notices" ("createdAt" desc);

create table if not exists "chess_travel_passengers" (
  id text primary key
,  "tripId" text
,  "userId" text
,  "status" text
,  "seatNo" numeric
,  "emergencyContact" text
,  "personalNotes" text
,  "addedBy" text
,  "confirmedAt" timestamptz
,  "createdAt" timestamptz
,  "confirmedBy" text
,  "withdrawnAt" timestamptz
,  "withdrawalReason" text
);
create index if not exists "chess_travel_passengers_created_idx" on "chess_travel_passengers" ("createdAt" desc);

create table if not exists "chess_travel_trips" (
  id text primary key
,  "title" text
,  "destination" text
,  "purpose" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "seatCapacity" numeric
,  "transportOptions" jsonb
,  "accommodationNote" text
,  "itinerary" jsonb
,  "status" text
,  "requestedBy" text
,  "approvedBy" text
,  "approvedAt" timestamptz
,  "rejectionReason" text
,  "completedAt" timestamptz
,  "paymentProcessed" boolean
,  "externalBookingRequired" boolean
,  "createdAt" timestamptz
,  "submittedAt" timestamptz
,  "submittedBy" text
,  "rejectedBy" text
);
create index if not exists "chess_travel_trips_created_idx" on "chess_travel_trips" ("createdAt" desc);

create table if not exists "chess_users" (
  id text primary key
,  "email" text
,  "name" text
,  "roles" jsonb
,  "state" text
,  "permissions" jsonb
,  "passwordHash" text
,  "createdAt" timestamptz
,  "importedBatchId" text
,  "rolesAssignedBy" text
,  "rolesAssignedAt" timestamptz
,  "passwordChangedAt" timestamptz
);
create index if not exists "chess_users_created_idx" on "chess_users" ("createdAt" desc);

create table if not exists "chess_volunteer_assignments" (
  id text primary key
,  "shiftId" text
,  "opportunityId" text
,  "volunteerId" text
,  "status" text
,  "checkedInAt" timestamptz
,  "checkedInBy" text
,  "feedback" text
,  "rating" numeric
,  "signedUpAt" timestamptz
,  "createdAt" timestamptz
,  "withdrawnAt" timestamptz
,  "respondedAt" timestamptz
,  "completedBy" text
,  "completedAt" timestamptz
);
create index if not exists "chess_volunteer_assignments_created_idx" on "chess_volunteer_assignments" ("createdAt" desc);

create table if not exists "chess_volunteer_opportunities" (
  id text primary key
,  "title" text
,  "description" text
,  "requirements" jsonb
,  "capacity" numeric
,  "activityId" text
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_volunteer_opportunities_created_idx" on "chess_volunteer_opportunities" ("createdAt" desc);

create table if not exists "chess_volunteer_shifts" (
  id text primary key
,  "opportunityId" text
,  "role" text
,  "startsAt" timestamptz
,  "endsAt" timestamptz
,  "capacity" numeric
,  "status" text
,  "createdBy" text
,  "createdAt" timestamptz
);
create index if not exists "chess_volunteer_shifts_created_idx" on "chess_volunteer_shifts" ("createdAt" desc);

-- Idempotent column additions for fields first seen in an update patch
alter table "chess_academic_year_events" add column if not exists "academicYearId" text;
alter table "chess_academic_year_events" add column if not exists "title" text;
alter table "chess_academic_year_events" add column if not exists "kind" text;
alter table "chess_academic_year_events" add column if not exists "startsOn" text;
alter table "chess_academic_year_events" add column if not exists "endsOn" text;
alter table "chess_academic_year_events" add column if not exists "source" text;
alter table "chess_academic_year_events" add column if not exists "createdBy" text;
alter table "chess_academic_year_events" add column if not exists "createdAt" timestamptz;
alter table "chess_academic_years" add column if not exists "label" text;
alter table "chess_academic_years" add column if not exists "startsOn" text;
alter table "chess_academic_years" add column if not exists "endsOn" text;
alter table "chess_academic_years" add column if not exists "isCurrent" boolean;
alter table "chess_academic_years" add column if not exists "version" numeric;
alter table "chess_academic_years" add column if not exists "status" text;
alter table "chess_academic_years" add column if not exists "supersedes" text;
alter table "chess_academic_years" add column if not exists "approvedBy" text;
alter table "chess_academic_years" add column if not exists "approvedAt" timestamptz;
alter table "chess_academic_years" add column if not exists "createdBy" text;
alter table "chess_academic_years" add column if not exists "createdAt" timestamptz;
alter table "chess_academic_years" add column if not exists "activatedBy" text;
alter table "chess_academic_years" add column if not exists "activatedAt" timestamptz;
alter table "chess_academic_years" add column if not exists "supersededBy" text;
alter table "chess_academic_years" add column if not exists "name" text;
alter table "chess_academic_years" add column if not exists "kind" text;
alter table "chess_academic_years" add column if not exists "startsAt" timestamptz;
alter table "chess_academic_years" add column if not exists "endsAt" timestamptz;
alter table "chess_academic_years" add column if not exists "supersedesId" text;
alter table "chess_academic_years" add column if not exists "proposedBy" text;
alter table "chess_academic_years" add column if not exists "supersededById" text;
alter table "chess_academic_years" add column if not exists "supersededAt" timestamptz;
alter table "chess_academy_coach_links" add column if not exists "coachId" text;
alter table "chess_academy_coach_links" add column if not exists "learnerId" text;
alter table "chess_academy_coach_links" add column if not exists "status" text;
alter table "chess_academy_coach_links" add column if not exists "createdBy" text;
alter table "chess_academy_coach_links" add column if not exists "createdAt" timestamptz;
alter table "chess_academy_courses" add column if not exists "title" text;
alter table "chess_academy_courses" add column if not exists "summary" text;
alter table "chess_academy_courses" add column if not exists "level" text;
alter table "chess_academy_courses" add column if not exists "prerequisites" jsonb;
alter table "chess_academy_courses" add column if not exists "status" text;
alter table "chess_academy_courses" add column if not exists "version" numeric;
alter table "chess_academy_courses" add column if not exists "authorId" text;
alter table "chess_academy_courses" add column if not exists "reviewerId" text;
alter table "chess_academy_courses" add column if not exists "source" text;
alter table "chess_academy_courses" add column if not exists "licence" text;
alter table "chess_academy_courses" add column if not exists "publishedAt" timestamptz;
alter table "chess_academy_courses" add column if not exists "createdAt" timestamptz;
alter table "chess_academy_enrollments" add column if not exists "courseId" text;
alter table "chess_academy_enrollments" add column if not exists "userId" text;
alter table "chess_academy_enrollments" add column if not exists "status" text;
alter table "chess_academy_enrollments" add column if not exists "enrolledAt" timestamptz;
alter table "chess_academy_lessons" add column if not exists "courseId" text;
alter table "chess_academy_lessons" add column if not exists "title" text;
alter table "chess_academy_lessons" add column if not exists "order" numeric;
alter table "chess_academy_lessons" add column if not exists "content" text;
alter table "chess_academy_lessons" add column if not exists "kind" text;
alter table "chess_academy_lessons" add column if not exists "status" text;
alter table "chess_academy_lessons" add column if not exists "version" numeric;
alter table "chess_academy_lessons" add column if not exists "authorId" text;
alter table "chess_academy_lessons" add column if not exists "createdAt" timestamptz;
alter table "chess_academy_lessons" add column if not exists "reviewerId" text;
alter table "chess_academy_lessons" add column if not exists "publishedAt" timestamptz;
alter table "chess_academy_progress" add column if not exists "courseId" text;
alter table "chess_academy_progress" add column if not exists "lessonId" text;
alter table "chess_academy_progress" add column if not exists "userId" text;
alter table "chess_academy_progress" add column if not exists "status" text;
alter table "chess_academy_progress" add column if not exists "score" text;
alter table "chess_academy_progress" add column if not exists "completedAt" timestamptz;
alter table "chess_academy_puzzle_attempts" add column if not exists "puzzleId" text;
alter table "chess_academy_puzzle_attempts" add column if not exists "userId" text;
alter table "chess_academy_puzzle_attempts" add column if not exists "topic" text;
alter table "chess_academy_puzzle_attempts" add column if not exists "solved" boolean;
alter table "chess_academy_puzzle_attempts" add column if not exists "at" text;
alter table "chess_accessibility_issues" add column if not exists "feature" text;
alter table "chess_accessibility_issues" add column if not exists "description" text;
alter table "chess_accessibility_issues" add column if not exists "severity" text;
alter table "chess_accessibility_issues" add column if not exists "wcagCriterion" text;
alter table "chess_accessibility_issues" add column if not exists "assistiveTech" text;
alter table "chess_accessibility_issues" add column if not exists "reportedBy" text;
alter table "chess_accessibility_issues" add column if not exists "status" text;
alter table "chess_accessibility_issues" add column if not exists "resolution" text;
alter table "chess_accessibility_issues" add column if not exists "resolvedBy" text;
alter table "chess_accessibility_issues" add column if not exists "resolvedAt" timestamptz;
alter table "chess_accessibility_issues" add column if not exists "createdAt" timestamptz;
alter table "chess_accessibility_preferences" add column if not exists "userId" text;
alter table "chess_accessibility_preferences" add column if not exists "reducedMotion" text;
alter table "chess_accessibility_preferences" add column if not exists "highContrast" boolean;
alter table "chess_accessibility_preferences" add column if not exists "contrastMode" text;
alter table "chess_accessibility_preferences" add column if not exists "fontScale" numeric;
alter table "chess_accessibility_preferences" add column if not exists "colorBlindSafeBoard" boolean;
alter table "chess_accessibility_preferences" add column if not exists "underlineLinks" boolean;
alter table "chess_accessibility_preferences" add column if not exists "screenReaderAnnouncements" boolean;
alter table "chess_accessibility_preferences" add column if not exists "keyboardOnlyHints" boolean;
alter table "chess_accessibility_preferences" add column if not exists "updatedBy" text;
alter table "chess_accessibility_preferences" add column if not exists "createdAt" timestamptz;
alter table "chess_achievement_templates" add column if not exists "code" text;
alter table "chess_achievement_templates" add column if not exists "name" text;
alter table "chess_achievement_templates" add column if not exists "version" numeric;
alter table "chess_achievement_templates" add column if not exists "active" boolean;
alter table "chess_achievement_templates" add column if not exists "createdBy" text;
alter table "chess_achievement_templates" add column if not exists "createdAt" timestamptz;
alter table "chess_achievements" add column if not exists "recipientId" text;
alter table "chess_achievements" add column if not exists "type" text;
alter table "chess_achievements" add column if not exists "title" text;
alter table "chess_achievements" add column if not exists "description" text;
alter table "chess_achievements" add column if not exists "sourceType" text;
alter table "chess_achievements" add column if not exists "sourceId" text;
alter table "chess_achievements" add column if not exists "status" text;
alter table "chess_achievements" add column if not exists "reason" text;
alter table "chess_achievements" add column if not exists "nominatedBy" text;
alter table "chess_achievements" add column if not exists "approvingOfficialId" text;
alter table "chess_achievements" add column if not exists "consentPublic" boolean;
alter table "chess_achievements" add column if not exists "awardedBy" text;
alter table "chess_achievements" add column if not exists "awardedAt" timestamptz;
alter table "chess_achievements" add column if not exists "createdAt" timestamptz;
alter table "chess_achievements" add column if not exists "disputeReason" text;
alter table "chess_achievements" add column if not exists "disputedAt" timestamptz;
alter table "chess_achievements" add column if not exists "consentUpdatedAt" timestamptz;
alter table "chess_achievements" add column if not exists "approvedAt" timestamptz;
alter table "chess_ai_budget_ledger" add column if not exists "callId" text;
alter table "chess_ai_budget_ledger" add column if not exists "kind" text;
alter table "chess_ai_budget_ledger" add column if not exists "paise" numeric;
alter table "chess_ai_budget_ledger" add column if not exists "balanceAfterPaise" numeric;
alter table "chess_ai_budget_ledger" add column if not exists "useCase" text;
alter table "chess_ai_budget_ledger" add column if not exists "actorId" text;
alter table "chess_ai_budget_ledger" add column if not exists "at" text;
alter table "chess_ai_budget_ledger" add column if not exists "createdAt" timestamptz;
alter table "chess_ai_calls" add column if not exists "actorId" text;
alter table "chess_ai_calls" add column if not exists "useCase" text;
alter table "chess_ai_calls" add column if not exists "promptChars" numeric;
alter table "chess_ai_calls" add column if not exists "costPaise" numeric;
alter table "chess_ai_calls" add column if not exists "outcome" text;
alter table "chess_ai_calls" add column if not exists "ledgerId" text;
alter table "chess_ai_calls" add column if not exists "at" text;
alter table "chess_ai_calls" add column if not exists "createdAt" timestamptz;
alter table "chess_ai_calls" add column if not exists "reason" text;
alter table "chess_ai_proposals" add column if not exists "targetTable" text;
alter table "chess_ai_proposals" add column if not exists "summary" text;
alter table "chess_ai_proposals" add column if not exists "useCase" text;
alter table "chess_ai_proposals" add column if not exists "status" text;
alter table "chess_ai_proposals" add column if not exists "advisoryOnly" boolean;
alter table "chess_ai_proposals" add column if not exists "applied" boolean;
alter table "chess_ai_proposals" add column if not exists "appliedByAi" boolean;
alter table "chess_ai_proposals" add column if not exists "requiresManualEntry" boolean;
alter table "chess_ai_proposals" add column if not exists "createdBy" text;
alter table "chess_ai_proposals" add column if not exists "createdAt" timestamptz;
alter table "chess_ai_proposals" add column if not exists "decidedBy" text;
alter table "chess_ai_proposals" add column if not exists "decidedAt" timestamptz;
alter table "chess_ai_proposals" add column if not exists "decisionNote" text;
alter table "chess_alumni_access_requests" add column if not exists "userId" text;
alter table "chess_alumni_access_requests" add column if not exists "contactEmail" text;
alter table "chess_alumni_access_requests" add column if not exists "contactEmailVerified" boolean;
alter table "chess_alumni_access_requests" add column if not exists "verificationCode" text;
alter table "chess_alumni_access_requests" add column if not exists "graduationYear" numeric;
alter table "chess_alumni_access_requests" add column if not exists "programme" text;
alter table "chess_alumni_access_requests" add column if not exists "status" text;
alter table "chess_alumni_access_requests" add column if not exists "reviewedBy" text;
alter table "chess_alumni_access_requests" add column if not exists "reviewReason" text;
alter table "chess_alumni_access_requests" add column if not exists "decidedAt" timestamptz;
alter table "chess_alumni_access_requests" add column if not exists "submittedAt" timestamptz;
alter table "chess_alumni_access_requests" add column if not exists "createdAt" timestamptz;
alter table "chess_alumni_access_requests" add column if not exists "contactEmailVerifiedAt" timestamptz;
alter table "chess_alumni_history_entries" add column if not exists "title" text;
alter table "chess_alumni_history_entries" add column if not exists "year" numeric;
alter table "chess_alumni_history_entries" add column if not exists "category" text;
alter table "chess_alumni_history_entries" add column if not exists "description" text;
alter table "chess_alumni_history_entries" add column if not exists "attributedUserId" text;
alter table "chess_alumni_history_entries" add column if not exists "recordedBy" text;
alter table "chess_alumni_history_entries" add column if not exists "createdAt" timestamptz;
alter table "chess_alumni_profiles" add column if not exists "headline" text;
alter table "chess_alumni_profiles" add column if not exists "userId" text;
alter table "chess_alumni_profiles" add column if not exists "requestId" text;
alter table "chess_alumni_profiles" add column if not exists "status" text;
alter table "chess_alumni_profiles" add column if not exists "graduationYear" numeric;
alter table "chess_alumni_profiles" add column if not exists "programme" text;
alter table "chess_alumni_profiles" add column if not exists "directoryVisible" boolean;
alter table "chess_alumni_profiles" add column if not exists "shareContact" boolean;
alter table "chess_alumni_profiles" add column if not exists "approvedBy" text;
alter table "chess_alumni_profiles" add column if not exists "approvedAt" timestamptz;
alter table "chess_alumni_profiles" add column if not exists "suspendedAt" timestamptz;
alter table "chess_alumni_profiles" add column if not exists "revokedAt" timestamptz;
alter table "chess_alumni_profiles" add column if not exists "createdAt" timestamptz;
alter table "chess_alumni_profiles" add column if not exists "statusReason" text;
alter table "chess_alumni_profiles" add column if not exists "statusChangedBy" text;
alter table "chess_alumni_profiles" add column if not exists "statusChangedAt" timestamptz;
alter table "chess_analysis_ai_credits" add column if not exists "userId" text;
alter table "chess_analysis_ai_credits" add column if not exists "credits" numeric;
alter table "chess_analysis_ai_credits" add column if not exists "createdAt" timestamptz;
alter table "chess_analysis_games" add column if not exists "ownerId" text;
alter table "chess_analysis_games" add column if not exists "source" text;
alter table "chess_analysis_games" add column if not exists "filename" text;
alter table "chess_analysis_games" add column if not exists "headers" jsonb;
alter table "chess_analysis_games" add column if not exists "white" text;
alter table "chess_analysis_games" add column if not exists "black" text;
alter table "chess_analysis_games" add column if not exists "event" text;
alter table "chess_analysis_games" add column if not exists "result" text;
alter table "chess_analysis_games" add column if not exists "moves" jsonb;
alter table "chess_analysis_games" add column if not exists "plyCount" numeric;
alter table "chess_analysis_games" add column if not exists "fen" text;
alter table "chess_analysis_games" add column if not exists "tags" jsonb;
alter table "chess_analysis_games" add column if not exists "visibility" text;
alter table "chess_analysis_games" add column if not exists "createdAt" timestamptz;
alter table "chess_analysis_reviews" add column if not exists "gameId" text;
alter table "chess_analysis_reviews" add column if not exists "requestedBy" text;
alter table "chess_analysis_reviews" add column if not exists "mode" text;
alter table "chess_analysis_reviews" add column if not exists "depth" numeric;
alter table "chess_analysis_reviews" add column if not exists "engine" text;
alter table "chess_analysis_reviews" add column if not exists "enginePerformanceBounded" boolean;
alter table "chess_analysis_reviews" add column if not exists "label" text;
alter table "chess_analysis_reviews" add column if not exists "officialResultAffecting" boolean;
alter table "chess_analysis_reviews" add column if not exists "summary" text;
alter table "chess_analysis_reviews" add column if not exists "themes" jsonb;
alter table "chess_analysis_reviews" add column if not exists "candidatePlans" jsonb;
alter table "chess_analysis_reviews" add column if not exists "aiExplanation" text;
alter table "chess_analysis_reviews" add column if not exists "aiCreditsRemaining" numeric;
alter table "chess_analysis_reviews" add column if not exists "createdAt" timestamptz;
alter table "chess_arena_events" add column if not exists "gameId" text;
alter table "chess_arena_events" add column if not exists "action" text;
alter table "chess_arena_events" add column if not exists "actorId" text;
alter table "chess_arena_events" add column if not exists "detail" jsonb;
alter table "chess_arena_events" add column if not exists "at" text;
alter table "chess_arena_games" add column if not exists "mode" text;
alter table "chess_arena_games" add column if not exists "status" text;
alter table "chess_arena_games" add column if not exists "tournamentId" text;
alter table "chess_arena_games" add column if not exists "whitePlayerId" text;
alter table "chess_arena_games" add column if not exists "blackPlayerId" text;
alter table "chess_arena_games" add column if not exists "timeControl" jsonb;
alter table "chess_arena_games" add column if not exists "clock" jsonb;
alter table "chess_arena_games" add column if not exists "ratingImpact" boolean;
alter table "chess_arena_games" add column if not exists "ratingApplied" boolean;
alter table "chess_arena_games" add column if not exists "ratingAppliedAt" timestamptz;
alter table "chess_arena_games" add column if not exists "ratingPipelineStatus" text;
alter table "chess_arena_games" add column if not exists "result" text;
alter table "chess_arena_games" add column if not exists "pgn" text;
alter table "chess_arena_games" add column if not exists "moves" jsonb;
alter table "chess_arena_games" add column if not exists "startedAt" timestamptz;
alter table "chess_arena_games" add column if not exists "endedAt" timestamptz;
alter table "chess_arena_games" add column if not exists "blockedModeConfirmed" boolean;
alter table "chess_arena_games" add column if not exists "disconnectedSide" text;
alter table "chess_arena_games" add column if not exists "clockBehavior" text;
alter table "chess_arena_games" add column if not exists "createdBy" text;
alter table "chess_arena_games" add column if not exists "invitationAccepted" boolean;
alter table "chess_arena_games" add column if not exists "invitationId" text;
alter table "chess_arena_games" add column if not exists "resultReason" text;
alter table "chess_arena_games" add column if not exists "disconnectedAt" timestamptz;
alter table "chess_arena_games" add column if not exists "reconnectedAt" timestamptz;
alter table "chess_arena_invitations" add column if not exists "inviteeId" text;
alter table "chess_arena_invitations" add column if not exists "inviterId" text;
alter table "chess_arena_invitations" add column if not exists "status" text;
alter table "chess_arena_invitations" add column if not exists "expiresAt" timestamptz;
alter table "chess_arena_invitations" add column if not exists "respondedAt" timestamptz;
alter table "chess_arena_invitations" add column if not exists "gameId" text;
alter table "chess_arena_reports" add column if not exists "gameId" text;
alter table "chess_arena_reports" add column if not exists "tournamentId" text;
alter table "chess_arena_reports" add column if not exists "reportedBy" text;
alter table "chess_arena_reports" add column if not exists "category" text;
alter table "chess_arena_reports" add column if not exists "detail" text;
alter table "chess_arena_reports" add column if not exists "status" text;
alter table "chess_arena_reports" add column if not exists "isFinding" boolean;
alter table "chess_arena_reports" add column if not exists "sanctionApplied" boolean;
alter table "chess_arena_reports" add column if not exists "reviewedBy" text;
alter table "chess_arena_reports" add column if not exists "reviewedAt" timestamptz;
alter table "chess_arena_reports" add column if not exists "outcome" text;
alter table "chess_arena_reports" add column if not exists "reviewNote" text;
alter table "chess_attendance_alerts" add column if not exists "matchId" text;
alter table "chess_attendance_alerts" add column if not exists "tournamentId" text;
alter table "chess_attendance_alerts" add column if not exists "playerId" text;
alter table "chess_attendance_alerts" add column if not exists "kind" text;
alter table "chess_attendance_alerts" add column if not exists "threshold" text;
alter table "chess_attendance_alerts" add column if not exists "status" text;
alter table "chess_attendance_alerts" add column if not exists "raisedAt" timestamptz;
alter table "chess_attendance_alerts" add column if not exists "organizerNotified" boolean;
alter table "chess_attendance_alerts" add column if not exists "resolvedBy" text;
alter table "chess_attendance_events" add column if not exists "matchId" text;
alter table "chess_attendance_events" add column if not exists "action" text;
alter table "chess_attendance_events" add column if not exists "actorId" text;
alter table "chess_attendance_events" add column if not exists "detail" jsonb;
alter table "chess_attendance_events" add column if not exists "at" text;
alter table "chess_attendance_explanations" add column if not exists "matchId" text;
alter table "chess_attendance_explanations" add column if not exists "tournamentId" text;
alter table "chess_attendance_explanations" add column if not exists "playerId" text;
alter table "chess_attendance_explanations" add column if not exists "category" text;
alter table "chess_attendance_explanations" add column if not exists "text" text;
alter table "chess_attendance_explanations" add column if not exists "visibility" text;
alter table "chess_attendance_explanations" add column if not exists "status" text;
alter table "chess_attendance_explanations" add column if not exists "reviewedBy" text;
alter table "chess_attendance_explanations" add column if not exists "reviewedAt" timestamptz;
alter table "chess_attendance_explanations" add column if not exists "decision" text;
alter table "chess_attendance_explanations" add column if not exists "reviewNote" text;
alter table "chess_attendance_incidents" add column if not exists "matchId" text;
alter table "chess_attendance_incidents" add column if not exists "tournamentId" text;
alter table "chess_attendance_incidents" add column if not exists "action" text;
alter table "chess_attendance_incidents" add column if not exists "reason" text;
alter table "chess_attendance_incidents" add column if not exists "actorId" text;
alter table "chess_attendance_incidents" add column if not exists "previousStatus" text;
alter table "chess_attendance_incidents" add column if not exists "newStatus" text;
alter table "chess_attendance_incidents" add column if not exists "at" text;
alter table "chess_attendance_matches" add column if not exists "tournamentId" text;
alter table "chess_attendance_matches" add column if not exists "whitePlayerId" text;
alter table "chess_attendance_matches" add column if not exists "blackPlayerId" text;
alter table "chess_attendance_matches" add column if not exists "startsAt" timestamptz;
alter table "chess_attendance_matches" add column if not exists "checkInOpensAt" timestamptz;
alter table "chess_attendance_matches" add column if not exists "graceEndsAt" timestamptz;
alter table "chess_attendance_matches" add column if not exists "board" numeric;
alter table "chess_attendance_matches" add column if not exists "round" numeric;
alter table "chess_attendance_matches" add column if not exists "status" text;
alter table "chess_attendance_matches" add column if not exists "attendanceStatus" text;
alter table "chess_attendance_matches" add column if not exists "walkover" jsonb;
alter table "chess_attendance_matches" add column if not exists "emergencyAction" text;
alter table "chess_attendance_matches" add column if not exists "attendanceReopened" boolean;
alter table "chess_attendance_matches" add column if not exists "createdBy" text;
alter table "chess_attendance_matches" add column if not exists "resultSource" text;
alter table "chess_attendance_matches" add column if not exists "emergencyReason" text;
alter table "chess_attendance_matches" add column if not exists "emergencyBy" text;
alter table "chess_attendance_matches" add column if not exists "emergencyAt" timestamptz;
alter table "chess_attendance_records" add column if not exists "matchId" text;
alter table "chess_attendance_records" add column if not exists "tournamentId" text;
alter table "chess_attendance_records" add column if not exists "playerId" text;
alter table "chess_attendance_records" add column if not exists "status" text;
alter table "chess_attendance_records" add column if not exists "checkedInAt" timestamptz;
alter table "chess_attendance_records" add column if not exists "late" boolean;
alter table "chess_attendance_records" add column if not exists "beyondGrace" boolean;
alter table "chess_attendance_records" add column if not exists "flagged" boolean;
alter table "chess_attendance_records" add column if not exists "checkInSource" text;
alter table "chess_attendance_records" add column if not exists "decidedBy" text;
alter table "chess_attendance_records" add column if not exists "decidedAt" timestamptz;
alter table "chess_attendance_records" add column if not exists "reason" text;
alter table "chess_attendance_records" add column if not exists "reopened" boolean;
alter table "chess_attendance_records" add column if not exists "recordedBy" text;
alter table "chess_award_categories" add column if not exists "seasonId" text;
alter table "chess_award_categories" add column if not exists "kind" text;
alter table "chess_award_categories" add column if not exists "name" text;
alter table "chess_award_categories" add column if not exists "minGames" numeric;
alter table "chess_award_categories" add column if not exists "pool" text;
alter table "chess_award_categories" add column if not exists "baselineStart" text;
alter table "chess_award_categories" add column if not exists "baselineEnd" text;
alter table "chess_award_categories" add column if not exists "criteria" jsonb;
alter table "chess_award_categories" add column if not exists "criteriaPublishedAt" timestamptz;
alter table "chess_award_categories" add column if not exists "status" text;
alter table "chess_award_categories" add column if not exists "createdBy" text;
alter table "chess_award_categories" add column if not exists "createdAt" timestamptz;
alter table "chess_award_categories" add column if not exists "winnerId" text;
alter table "chess_award_nominations" add column if not exists "seasonId" text;
alter table "chess_award_nominations" add column if not exists "categoryId" text;
alter table "chess_award_nominations" add column if not exists "nominatedUserId" text;
alter table "chess_award_nominations" add column if not exists "nominatedBy" text;
alter table "chess_award_nominations" add column if not exists "reason" text;
alter table "chess_award_nominations" add column if not exists "status" text;
alter table "chess_award_nominations" add column if not exists "reviewedBy" text;
alter table "chess_award_nominations" add column if not exists "createdAt" timestamptz;
alter table "chess_award_winners" add column if not exists "seasonId" text;
alter table "chess_award_winners" add column if not exists "categoryId" text;
alter table "chess_award_winners" add column if not exists "categoryKind" text;
alter table "chess_award_winners" add column if not exists "userId" text;
alter table "chess_award_winners" add column if not exists "score" numeric;
alter table "chess_award_winners" add column if not exists "basis" text;
alter table "chess_award_winners" add column if not exists "certificateId" text;
alter table "chess_award_winners" add column if not exists "approvedBy" text;
alter table "chess_award_winners" add column if not exists "approvedAt" timestamptz;
alter table "chess_award_winners" add column if not exists "publishedAt" timestamptz;
alter table "chess_award_winners" add column if not exists "status" text;
alter table "chess_award_winners" add column if not exists "version" numeric;
alter table "chess_calendar_entries" add column if not exists "seriesId" text;
alter table "chess_calendar_entries" add column if not exists "title" text;
alter table "chess_calendar_entries" add column if not exists "type" text;
alter table "chess_calendar_entries" add column if not exists "source" text;
alter table "chess_calendar_entries" add column if not exists "startsAt" timestamptz;
alter table "chess_calendar_entries" add column if not exists "endsAt" timestamptz;
alter table "chess_calendar_entries" add column if not exists "timezone" text;
alter table "chess_calendar_entries" add column if not exists "venueId" text;
alter table "chess_calendar_entries" add column if not exists "hostId" text;
alter table "chess_calendar_entries" add column if not exists "audience" jsonb;
alter table "chess_calendar_entries" add column if not exists "academicYearId" text;
alter table "chess_calendar_entries" add column if not exists "status" text;
alter table "chess_calendar_entries" add column if not exists "conflictWarnings" jsonb;
alter table "chess_calendar_entries" add column if not exists "createdBy" text;
alter table "chess_calendar_entries" add column if not exists "createdAt" timestamptz;
alter table "chess_certificates" add column if not exists "achievementId" text;
alter table "chess_certificates" add column if not exists "recipientId" text;
alter table "chess_certificates" add column if not exists "templateCode" text;
alter table "chess_certificates" add column if not exists "templateVersion" numeric;
alter table "chess_certificates" add column if not exists "verificationCode" text;
alter table "chess_certificates" add column if not exists "status" text;
alter table "chess_certificates" add column if not exists "issuedBy" text;
alter table "chess_certificates" add column if not exists "issuedAt" timestamptz;
alter table "chess_certificates" add column if not exists "revokedBy" text;
alter table "chess_certificates" add column if not exists "revokeReason" text;
alter table "chess_certificates" add column if not exists "revokedAt" timestamptz;
alter table "chess_certificates" add column if not exists "createdAt" timestamptz;
alter table "chess_championship_seasons" add column if not exists "name" text;
alter table "chess_championship_seasons" add column if not exists "year" numeric;
alter table "chess_championship_seasons" add column if not exists "startsAt" timestamptz;
alter table "chess_championship_seasons" add column if not exists "endsAt" timestamptz;
alter table "chess_championship_seasons" add column if not exists "status" text;
alter table "chess_championship_seasons" add column if not exists "criteriaPublishedAt" timestamptz;
alter table "chess_championship_seasons" add column if not exists "createdBy" text;
alter table "chess_championship_seasons" add column if not exists "createdAt" timestamptz;
alter table "chess_club_events" add column if not exists "title" text;
alter table "chess_club_events" add column if not exists "description" text;
alter table "chess_club_events" add column if not exists "category" text;
alter table "chess_club_events" add column if not exists "hostId" text;
alter table "chess_club_events" add column if not exists "eligibility" text;
alter table "chess_club_events" add column if not exists "visibility" text;
alter table "chess_club_events" add column if not exists "capacity" numeric;
alter table "chess_club_events" add column if not exists "waitlistEnabled" boolean;
alter table "chess_club_events" add column if not exists "registrationMode" text;
alter table "chess_club_events" add column if not exists "registrationOpensAt" timestamptz;
alter table "chess_club_events" add column if not exists "registrationClosesAt" timestamptz;
alter table "chess_club_events" add column if not exists "startsAt" timestamptz;
alter table "chess_club_events" add column if not exists "endsAt" timestamptz;
alter table "chess_club_events" add column if not exists "venue" text;
alter table "chess_club_events" add column if not exists "meetingLink" text;
alter table "chess_club_events" add column if not exists "accessibility" text;
alter table "chess_club_events" add column if not exists "materials" jsonb;
alter table "chess_club_events" add column if not exists "cancellationPolicy" text;
alter table "chess_club_events" add column if not exists "notificationRules" jsonb;
alter table "chess_club_events" add column if not exists "status" text;
alter table "chess_club_events" add column if not exists "createdBy" text;
alter table "chess_club_events" add column if not exists "createdAt" timestamptz;
alter table "chess_club_events" add column if not exists "publishedAt" timestamptz;
alter table "chess_club_events" add column if not exists "publishedBy" text;
alter table "chess_coaching_assignments" add column if not exists "coachId" text;
alter table "chess_coaching_assignments" add column if not exists "studentId" text;
alter table "chess_coaching_assignments" add column if not exists "offeringId" text;
alter table "chess_coaching_assignments" add column if not exists "status" text;
alter table "chess_coaching_assignments" add column if not exists "createdBy" text;
alter table "chess_coaching_assignments" add column if not exists "createdAt" timestamptz;
alter table "chess_coaching_calendar_entries" add column if not exists "sessionId" text;
alter table "chess_coaching_calendar_entries" add column if not exists "coachId" text;
alter table "chess_coaching_calendar_entries" add column if not exists "studentIds" jsonb;
alter table "chess_coaching_calendar_entries" add column if not exists "startsAt" timestamptz;
alter table "chess_coaching_calendar_entries" add column if not exists "endsAt" timestamptz;
alter table "chess_coaching_calendar_entries" add column if not exists "venueType" text;
alter table "chess_coaching_calendar_entries" add column if not exists "createdAt" timestamptz;
alter table "chess_coaching_notes" add column if not exists "sessionId" text;
alter table "chess_coaching_notes" add column if not exists "coachId" text;
alter table "chess_coaching_notes" add column if not exists "studentIds" jsonb;
alter table "chess_coaching_notes" add column if not exists "text" text;
alter table "chess_coaching_notes" add column if not exists "nextSteps" text;
alter table "chess_coaching_notes" add column if not exists "visibility" text;
alter table "chess_coaching_notes" add column if not exists "createdAt" timestamptz;
alter table "chess_coaching_notifications" add column if not exists "sessionId" text;
alter table "chess_coaching_notifications" add column if not exists "job" text;
alter table "chess_coaching_notifications" add column if not exists "recipients" jsonb;
alter table "chess_coaching_notifications" add column if not exists "status" text;
alter table "chess_coaching_notifications" add column if not exists "createdAt" timestamptz;
alter table "chess_coaching_offerings" add column if not exists "title" text;
alter table "chess_coaching_offerings" add column if not exists "type" text;
alter table "chess_coaching_offerings" add column if not exists "coachId" text;
alter table "chess_coaching_offerings" add column if not exists "capacity" numeric;
alter table "chess_coaching_offerings" add column if not exists "venueType" text;
alter table "chess_coaching_offerings" add column if not exists "venue" text;
alter table "chess_coaching_offerings" add column if not exists "meetingLink" text;
alter table "chess_coaching_offerings" add column if not exists "meetingIntegration" text;
alter table "chess_coaching_offerings" add column if not exists "status" text;
alter table "chess_coaching_offerings" add column if not exists "createdBy" text;
alter table "chess_coaching_offerings" add column if not exists "createdAt" timestamptz;
alter table "chess_coaching_sessions" add column if not exists "offeringId" text;
alter table "chess_coaching_sessions" add column if not exists "coachId" text;
alter table "chess_coaching_sessions" add column if not exists "studentIds" jsonb;
alter table "chess_coaching_sessions" add column if not exists "startsAt" timestamptz;
alter table "chess_coaching_sessions" add column if not exists "endsAt" timestamptz;
alter table "chess_coaching_sessions" add column if not exists "venueType" text;
alter table "chess_coaching_sessions" add column if not exists "venue" text;
alter table "chess_coaching_sessions" add column if not exists "meetingLink" text;
alter table "chess_coaching_sessions" add column if not exists "status" text;
alter table "chess_coaching_sessions" add column if not exists "requestedBy" text;
alter table "chess_coaching_sessions" add column if not exists "confirmedBy" text;
alter table "chess_coaching_sessions" add column if not exists "completedAt" timestamptz;
alter table "chess_coaching_sessions" add column if not exists "participation" jsonb;
alter table "chess_coaching_sessions" add column if not exists "createdAt" timestamptz;
alter table "chess_coaching_sessions" add column if not exists "confirmedAt" timestamptz;
alter table "chess_command_snapshots" add column if not exists "generatedAt" timestamptz;
alter table "chess_command_snapshots" add column if not exists "actorId" text;
alter table "chess_command_snapshots" add column if not exists "summary" jsonb;
alter table "chess_command_snapshots" add column if not exists "degradedTables" jsonb;
alter table "chess_command_snapshots" add column if not exists "createdAt" timestamptz;
alter table "chess_commentary_assignments" add column if not exists "matchId" text;
alter table "chess_commentary_assignments" add column if not exists "userId" text;
alter table "chess_commentary_assignments" add column if not exists "displayName" text;
alter table "chess_commentary_assignments" add column if not exists "assignedBy" text;
alter table "chess_commentary_assignments" add column if not exists "status" text;
alter table "chess_commentary_assignments" add column if not exists "createdAt" timestamptz;
alter table "chess_commentary_edits" add column if not exists "entryId" text;
alter table "chess_commentary_edits" add column if not exists "matchId" text;
alter table "chess_commentary_edits" add column if not exists "revision" numeric;
alter table "chess_commentary_edits" add column if not exists "previousText" text;
alter table "chess_commentary_edits" add column if not exists "newText" text;
alter table "chess_commentary_edits" add column if not exists "editedBy" text;
alter table "chess_commentary_edits" add column if not exists "editedAt" timestamptz;
alter table "chess_commentary_entries" add column if not exists "matchId" text;
alter table "chess_commentary_entries" add column if not exists "seq" numeric;
alter table "chess_commentary_entries" add column if not exists "text" text;
alter table "chess_commentary_entries" add column if not exists "kind" text;
alter table "chess_commentary_entries" add column if not exists "moveNumber" numeric;
alter table "chess_commentary_entries" add column if not exists "authorId" text;
alter table "chess_commentary_entries" add column if not exists "authorDisplayName" text;
alter table "chess_commentary_entries" add column if not exists "revision" numeric;
alter table "chess_commentary_entries" add column if not exists "status" text;
alter table "chess_commentary_entries" add column if not exists "editedAt" timestamptz;
alter table "chess_commentary_entries" add column if not exists "deletedAt" timestamptz;
alter table "chess_commentary_entries" add column if not exists "deletedBy" text;
alter table "chess_commentary_entries" add column if not exists "createdAt" timestamptz;
alter table "chess_commentary_entries" add column if not exists "editedBy" text;
alter table "chess_commentary_settings" add column if not exists "matchId" text;
alter table "chess_commentary_settings" add column if not exists "delaySeconds" numeric;
alter table "chess_commentary_settings" add column if not exists "updatedBy" text;
alter table "chess_commentary_settings" add column if not exists "createdAt" timestamptz;
alter table "chess_community_blocks" add column if not exists "blockerId" text;
alter table "chess_community_blocks" add column if not exists "blockedId" text;
alter table "chess_community_blocks" add column if not exists "createdAt" timestamptz;
alter table "chess_community_comments" add column if not exists "postId" text;
alter table "chess_community_comments" add column if not exists "authorId" text;
alter table "chess_community_comments" add column if not exists "body" text;
alter table "chess_community_comments" add column if not exists "moderationState" text;
alter table "chess_community_comments" add column if not exists "moderatedBy" text;
alter table "chess_community_comments" add column if not exists "moderationReason" text;
alter table "chess_community_comments" add column if not exists "moderatedAt" timestamptz;
alter table "chess_community_comments" add column if not exists "createdAt" timestamptz;
alter table "chess_community_posts" add column if not exists "authorId" text;
alter table "chess_community_posts" add column if not exists "title" text;
alter table "chess_community_posts" add column if not exists "body" text;
alter table "chess_community_posts" add column if not exists "scope" text;
alter table "chess_community_posts" add column if not exists "isPublic" boolean;
alter table "chess_community_posts" add column if not exists "moderationState" text;
alter table "chess_community_posts" add column if not exists "moderatedBy" text;
alter table "chess_community_posts" add column if not exists "moderationReason" text;
alter table "chess_community_posts" add column if not exists "moderatedAt" timestamptz;
alter table "chess_community_posts" add column if not exists "commentCount" numeric;
alter table "chess_community_posts" add column if not exists "createdAt" timestamptz;
alter table "chess_community_reports" add column if not exists "reporterId" text;
alter table "chess_community_reports" add column if not exists "targetType" text;
alter table "chess_community_reports" add column if not exists "targetId" text;
alter table "chess_community_reports" add column if not exists "reason" text;
alter table "chess_community_reports" add column if not exists "status" text;
alter table "chess_community_reports" add column if not exists "verified" boolean;
alter table "chess_community_reports" add column if not exists "resolvedBy" text;
alter table "chess_community_reports" add column if not exists "resolutionReason" text;
alter table "chess_community_reports" add column if not exists "outcome" text;
alter table "chess_community_reports" add column if not exists "resolvedAt" timestamptz;
alter table "chess_community_reports" add column if not exists "createdAt" timestamptz;
alter table "chess_compliance_consents" add column if not exists "subjectId" text;
alter table "chess_compliance_consents" add column if not exists "purpose" text;
alter table "chess_compliance_consents" add column if not exists "basis" text;
alter table "chess_compliance_consents" add column if not exists "status" text;
alter table "chess_compliance_consents" add column if not exists "granted" boolean;
alter table "chess_compliance_consents" add column if not exists "policyVersion" text;
alter table "chess_compliance_consents" add column if not exists "grantedAt" timestamptz;
alter table "chess_compliance_consents" add column if not exists "withdrawnAt" timestamptz;
alter table "chess_compliance_consents" add column if not exists "recordedBy" text;
alter table "chess_compliance_consents" add column if not exists "createdAt" timestamptz;
alter table "chess_compliance_data_requests" add column if not exists "subjectId" text;
alter table "chess_compliance_data_requests" add column if not exists "type" text;
alter table "chess_compliance_data_requests" add column if not exists "status" text;
alter table "chess_compliance_data_requests" add column if not exists "raisedBy" text;
alter table "chess_compliance_data_requests" add column if not exists "details" text;
alter table "chess_compliance_data_requests" add column if not exists "dueAt" timestamptz;
alter table "chess_compliance_data_requests" add column if not exists "receivedAt" timestamptz;
alter table "chess_compliance_data_requests" add column if not exists "completedAt" timestamptz;
alter table "chess_compliance_data_requests" add column if not exists "decision" text;
alter table "chess_compliance_data_requests" add column if not exists "decisionReason" text;
alter table "chess_compliance_data_requests" add column if not exists "legalHold" boolean;
alter table "chess_compliance_data_requests" add column if not exists "history" jsonb;
alter table "chess_compliance_data_requests" add column if not exists "createdAt" timestamptz;
alter table "chess_compliance_data_requests" add column if not exists "decidedBy" text;
alter table "chess_compliance_data_requests" add column if not exists "decidedAt" timestamptz;
alter table "chess_compliance_data_requests" add column if not exists "legalHoldReason" text;
alter table "chess_compliance_policies" add column if not exists "key" text;
alter table "chess_compliance_policies" add column if not exists "title" text;
alter table "chess_compliance_policies" add column if not exists "version" numeric;
alter table "chess_compliance_policies" add column if not exists "ownerId" text;
alter table "chess_compliance_policies" add column if not exists "effectiveDate" timestamptz;
alter table "chess_compliance_policies" add column if not exists "reviewDueAt" timestamptz;
alter table "chess_compliance_policies" add column if not exists "status" text;
alter table "chess_compliance_policies" add column if not exists "reviewedBy" text;
alter table "chess_compliance_policies" add column if not exists "publishedAt" timestamptz;
alter table "chess_compliance_policies" add column if not exists "complianceClaimed" boolean;
alter table "chess_compliance_policies" add column if not exists "notes" text;
alter table "chess_compliance_policies" add column if not exists "createdBy" text;
alter table "chess_compliance_policies" add column if not exists "createdAt" timestamptz;
alter table "chess_compliance_privacy_incidents" add column if not exists "title" text;
alter table "chess_compliance_privacy_incidents" add column if not exists "severity" text;
alter table "chess_compliance_privacy_incidents" add column if not exists "description" text;
alter table "chess_compliance_privacy_incidents" add column if not exists "personalDataInvolved" boolean;
alter table "chess_compliance_privacy_incidents" add column if not exists "status" text;
alter table "chess_compliance_privacy_incidents" add column if not exists "escalationLevel" numeric;
alter table "chess_compliance_privacy_incidents" add column if not exists "escalatedTo" text;
alter table "chess_compliance_privacy_incidents" add column if not exists "reportedBy" text;
alter table "chess_compliance_privacy_incidents" add column if not exists "reportedAt" timestamptz;
alter table "chess_compliance_privacy_incidents" add column if not exists "createdAt" timestamptz;
alter table "chess_compliance_privacy_incidents" add column if not exists "escalatedAt" timestamptz;
alter table "chess_compliance_retention_rules" add column if not exists "dataCategory" text;
alter table "chess_compliance_retention_rules" add column if not exists "retentionMonths" numeric;
alter table "chess_compliance_retention_rules" add column if not exists "basis" text;
alter table "chess_compliance_retention_rules" add column if not exists "reviewedBy" text;
alter table "chess_compliance_retention_rules" add column if not exists "reviewDueAt" timestamptz;
alter table "chess_compliance_retention_rules" add column if not exists "status" text;
alter table "chess_compliance_retention_rules" add column if not exists "createdAt" timestamptz;
alter table "chess_data_backup_jobs" add column if not exists "scope" text;
alter table "chess_data_backup_jobs" add column if not exists "target" text;
alter table "chess_data_backup_jobs" add column if not exists "process" text;
alter table "chess_data_backup_jobs" add column if not exists "status" text;
alter table "chess_data_backup_jobs" add column if not exists "checksum" text;
alter table "chess_data_backup_jobs" add column if not exists "sizeBytes" numeric;
alter table "chess_data_backup_jobs" add column if not exists "encrypted" boolean;
alter table "chess_data_backup_jobs" add column if not exists "storageRef" text;
alter table "chess_data_backup_jobs" add column if not exists "integrityVerified" boolean;
alter table "chess_data_backup_jobs" add column if not exists "integrityVerifiedAt" timestamptz;
alter table "chess_data_backup_jobs" add column if not exists "restoreVerified" boolean;
alter table "chess_data_backup_jobs" add column if not exists "restoreVerifiedAt" timestamptz;
alter table "chess_data_backup_jobs" add column if not exists "valid" boolean;
alter table "chess_data_backup_jobs" add column if not exists "failureReason" text;
alter table "chess_data_backup_jobs" add column if not exists "note" text;
alter table "chess_data_backup_jobs" add column if not exists "createdBy" text;
alter table "chess_data_backup_jobs" add column if not exists "createdAt" timestamptz;
alter table "chess_data_backup_jobs" add column if not exists "completedAt" timestamptz;
alter table "chess_data_backup_jobs" add column if not exists "integrityVerifiedBy" text;
alter table "chess_data_backup_jobs" add column if not exists "restoreVerifiedBy" text;
alter table "chess_data_backup_jobs" add column if not exists "restoreEnvironment" text;
alter table "chess_data_export_requests" add column if not exists "scope" text;
alter table "chess_data_export_requests" add column if not exists "format" text;
alter table "chess_data_export_requests" add column if not exists "containsSensitive" boolean;
alter table "chess_data_export_requests" add column if not exists "requestedBy" text;
alter table "chess_data_export_requests" add column if not exists "status" text;
alter table "chess_data_export_requests" add column if not exists "rowLimit" numeric;
alter table "chess_data_export_requests" add column if not exists "createdAt" timestamptz;
alter table "chess_data_import_batches" add column if not exists "target" text;
alter table "chess_data_import_batches" add column if not exists "table" text;
alter table "chess_data_import_batches" add column if not exists "keyField" text;
alter table "chess_data_import_batches" add column if not exists "total" numeric;
alter table "chess_data_import_batches" add column if not exists "validCount" numeric;
alter table "chess_data_import_batches" add column if not exists "invalidCount" numeric;
alter table "chess_data_import_batches" add column if not exists "conflictCount" numeric;
alter table "chess_data_import_batches" add column if not exists "valid" jsonb;
alter table "chess_data_import_batches" add column if not exists "invalid" jsonb;
alter table "chess_data_import_batches" add column if not exists "conflicts" jsonb;
alter table "chess_data_import_batches" add column if not exists "status" text;
alter table "chess_data_import_batches" add column if not exists "requiresConfirmation" boolean;
alter table "chess_data_import_batches" add column if not exists "previewedBy" text;
alter table "chess_data_import_batches" add column if not exists "createdAt" timestamptz;
alter table "chess_data_import_batches" add column if not exists "committedCount" numeric;
alter table "chess_data_import_batches" add column if not exists "committedAt" timestamptz;
alter table "chess_data_import_batches" add column if not exists "committedBy" text;
alter table "chess_data_import_batches" add column if not exists "overwriteAuthorised" boolean;
alter table "chess_data_restore_requests" add column if not exists "backupId" text;
alter table "chess_data_restore_requests" add column if not exists "reason" text;
alter table "chess_data_restore_requests" add column if not exists "requestedBy" text;
alter table "chess_data_restore_requests" add column if not exists "status" text;
alter table "chess_data_restore_requests" add column if not exists "approvedBy" text;
alter table "chess_data_restore_requests" add column if not exists "approvedAt" timestamptz;
alter table "chess_data_restore_requests" add column if not exists "executedAt" timestamptz;
alter table "chess_data_restore_requests" add column if not exists "idempotencyKey" text;
alter table "chess_data_restore_requests" add column if not exists "createdAt" timestamptz;
alter table "chess_data_restore_requests" add column if not exists "approvalNote" text;
alter table "chess_data_restore_requests" add column if not exists "executedBy" text;
alter table "chess_data_restore_requests" add column if not exists "suppressedDuplicateActions" jsonb;
alter table "chess_domain_allowlist" add column if not exists "domain" text;
alter table "chess_domain_allowlist" add column if not exists "applicantType" text;
alter table "chess_domain_allowlist" add column if not exists "active" boolean;
alter table "chess_domain_allowlist" add column if not exists "addedBy" text;
alter table "chess_domain_allowlist" add column if not exists "createdAt" timestamptz;
alter table "chess_event_registrations" add column if not exists "eventId" text;
alter table "chess_event_registrations" add column if not exists "userId" text;
alter table "chess_event_registrations" add column if not exists "status" text;
alter table "chess_event_registrations" add column if not exists "waitlistPosition" numeric;
alter table "chess_event_registrations" add column if not exists "addedManually" boolean;
alter table "chess_event_registrations" add column if not exists "registeredBy" text;
alter table "chess_event_registrations" add column if not exists "registeredAt" timestamptz;
alter table "chess_event_registrations" add column if not exists "withdrawnAt" timestamptz;
alter table "chess_event_registrations" add column if not exists "withdrawnReason" text;
alter table "chess_event_registrations" add column if not exists "promotedAt" timestamptz;
alter table "chess_event_registrations" add column if not exists "decidedBy" text;
alter table "chess_event_registrations" add column if not exists "decidedAt" timestamptz;
alter table "chess_events" add column if not exists "title" text;
alter table "chess_events" add column if not exists "description" text;
alter table "chess_events" add column if not exists "status" text;
alter table "chess_events" add column if not exists "createdAt" timestamptz;
alter table "chess_experience_feedback" add column if not exists "type" text;
alter table "chess_experience_feedback" add column if not exists "title" text;
alter table "chess_experience_feedback" add column if not exists "description" text;
alter table "chess_experience_feedback" add column if not exists "severity" text;
alter table "chess_experience_feedback" add column if not exists "page" text;
alter table "chess_experience_feedback" add column if not exists "context" text;
alter table "chess_experience_feedback" add column if not exists "submittedBy" text;
alter table "chess_experience_feedback" add column if not exists "queue" text;
alter table "chess_experience_feedback" add column if not exists "visibility" text;
alter table "chess_experience_feedback" add column if not exists "publicVotable" boolean;
alter table "chess_experience_feedback" add column if not exists "securitySensitive" boolean;
alter table "chess_experience_feedback" add column if not exists "status" text;
alter table "chess_experience_feedback" add column if not exists "priority" text;
alter table "chess_experience_feedback" add column if not exists "assignedTo" text;
alter table "chess_experience_feedback" add column if not exists "duplicateOf" text;
alter table "chess_experience_feedback" add column if not exists "roadmapPublished" boolean;
alter table "chess_experience_feedback" add column if not exists "triageHistory" jsonb;
alter table "chess_experience_feedback" add column if not exists "createdAt" timestamptz;
alter table "chess_experience_feedback" add column if not exists "triagedBy" text;
alter table "chess_experience_feedback" add column if not exists "triagedAt" timestamptz;
alter table "chess_experience_feedback" add column if not exists "resolvedAt" timestamptz;
alter table "chess_experience_feedback" add column if not exists "publicApproved" boolean;
alter table "chess_experience_feedback" add column if not exists "approvedBy" text;
alter table "chess_experience_feedback" add column if not exists "publicTitle" text;
alter table "chess_experience_feedback" add column if not exists "promisedDate" timestamptz;
alter table "chess_experience_feedback" add column if not exists "roadmapPublishedAt" timestamptz;
alter table "chess_experience_votes" add column if not exists "feedbackId" text;
alter table "chess_experience_votes" add column if not exists "userId" text;
alter table "chess_experience_votes" add column if not exists "createdAt" timestamptz;
alter table "chess_facility_bookings" add column if not exists "venueId" text;
alter table "chess_facility_bookings" add column if not exists "requestedBy" text;
alter table "chess_facility_bookings" add column if not exists "purpose" text;
alter table "chess_facility_bookings" add column if not exists "startsAt" timestamptz;
alter table "chess_facility_bookings" add column if not exists "endsAt" timestamptz;
alter table "chess_facility_bookings" add column if not exists "attendees" numeric;
alter table "chess_facility_bookings" add column if not exists "status" text;
alter table "chess_facility_bookings" add column if not exists "approvedBy" text;
alter table "chess_facility_bookings" add column if not exists "decidedAt" timestamptz;
alter table "chess_facility_bookings" add column if not exists "cancelledBy" text;
alter table "chess_facility_bookings" add column if not exists "cancelReason" text;
alter table "chess_facility_bookings" add column if not exists "createdAt" timestamptz;
alter table "chess_facility_bookings" add column if not exists "cancelledAt" timestamptz;
alter table "chess_facility_maintenance" add column if not exists "venueId" text;
alter table "chess_facility_maintenance" add column if not exists "startsAt" timestamptz;
alter table "chess_facility_maintenance" add column if not exists "endsAt" timestamptz;
alter table "chess_facility_maintenance" add column if not exists "note" text;
alter table "chess_facility_maintenance" add column if not exists "status" text;
alter table "chess_facility_maintenance" add column if not exists "createdBy" text;
alter table "chess_facility_maintenance" add column if not exists "createdAt" timestamptz;
alter table "chess_facility_venues" add column if not exists "name" text;
alter table "chess_facility_venues" add column if not exists "building" text;
alter table "chess_facility_venues" add column if not exists "room" text;
alter table "chess_facility_venues" add column if not exists "capacity" numeric;
alter table "chess_facility_venues" add column if not exists "boardCount" numeric;
alter table "chess_facility_venues" add column if not exists "layout" jsonb;
alter table "chess_facility_venues" add column if not exists "accessibility" text;
alter table "chess_facility_venues" add column if not exists "safetyNotes" text;
alter table "chess_facility_venues" add column if not exists "status" text;
alter table "chess_facility_venues" add column if not exists "managerId" text;
alter table "chess_facility_venues" add column if not exists "createdAt" timestamptz;
alter table "chess_finance_contributions" add column if not exists "source" text;
alter table "chess_finance_contributions" add column if not exists "kind" text;
alter table "chess_finance_contributions" add column if not exists "amountPaise" numeric;
alter table "chess_finance_contributions" add column if not exists "reference" text;
alter table "chess_finance_contributions" add column if not exists "receivedAt" timestamptz;
alter table "chess_finance_contributions" add column if not exists "status" text;
alter table "chess_finance_contributions" add column if not exists "recordedBy" text;
alter table "chess_finance_contributions" add column if not exists "approvedBy" text;
alter table "chess_finance_contributions" add column if not exists "approvedAt" timestamptz;
alter table "chess_finance_contributions" add column if not exists "createdAt" timestamptz;
alter table "chess_finance_contributions" add column if not exists "ledgerGroupId" text;
alter table "chess_finance_expenses" add column if not exists "description" text;
alter table "chess_finance_expenses" add column if not exists "amountPaise" numeric;
alter table "chess_finance_expenses" add column if not exists "category" text;
alter table "chess_finance_expenses" add column if not exists "payee" text;
alter table "chess_finance_expenses" add column if not exists "budgetId" text;
alter table "chess_finance_expenses" add column if not exists "receiptFileId" text;
alter table "chess_finance_expenses" add column if not exists "receiptStorage" text;
alter table "chess_finance_expenses" add column if not exists "status" text;
alter table "chess_finance_expenses" add column if not exists "requestedBy" text;
alter table "chess_finance_expenses" add column if not exists "approvedBy" text;
alter table "chess_finance_expenses" add column if not exists "approvedAt" timestamptz;
alter table "chess_finance_expenses" add column if not exists "rejectedBy" text;
alter table "chess_finance_expenses" add column if not exists "rejectedAt" timestamptz;
alter table "chess_finance_expenses" add column if not exists "ledgerGroupId" text;
alter table "chess_finance_expenses" add column if not exists "createdAt" timestamptz;
alter table "chess_finance_ledger_entries" add column if not exists "groupId" text;
alter table "chess_finance_ledger_entries" add column if not exists "kind" text;
alter table "chess_finance_ledger_entries" add column if not exists "account" text;
alter table "chess_finance_ledger_entries" add column if not exists "debitPaise" numeric;
alter table "chess_finance_ledger_entries" add column if not exists "creditPaise" numeric;
alter table "chess_finance_ledger_entries" add column if not exists "amountPaise" numeric;
alter table "chess_finance_ledger_entries" add column if not exists "description" text;
alter table "chess_finance_ledger_entries" add column if not exists "refType" text;
alter table "chess_finance_ledger_entries" add column if not exists "refId" text;
alter table "chess_finance_ledger_entries" add column if not exists "postedBy" text;
alter table "chess_finance_ledger_entries" add column if not exists "postedAt" timestamptz;
alter table "chess_finance_ledger_entries" add column if not exists "createdAt" timestamptz;
alter table "chess_finance_periods" add column if not exists "label" text;
alter table "chess_finance_periods" add column if not exists "endsAt" timestamptz;
alter table "chess_finance_periods" add column if not exists "incomePaise" numeric;
alter table "chess_finance_periods" add column if not exists "expensePaise" numeric;
alter table "chess_finance_periods" add column if not exists "balancePaise" numeric;
alter table "chess_finance_periods" add column if not exists "entryCount" numeric;
alter table "chess_finance_periods" add column if not exists "status" text;
alter table "chess_finance_periods" add column if not exists "closedBy" text;
alter table "chess_finance_periods" add column if not exists "closedAt" timestamptz;
alter table "chess_finance_periods" add column if not exists "createdAt" timestamptz;
alter table "chess_format_configs" add column if not exists "tournamentId" text;
alter table "chess_format_configs" add column if not exists "format" text;
alter table "chess_format_configs" add column if not exists "rounds" numeric;
alter table "chess_format_configs" add column if not exists "participantIds" jsonb;
alter table "chess_format_configs" add column if not exists "teams" jsonb;
alter table "chess_format_configs" add column if not exists "tieBreakers" jsonb;
alter table "chess_format_configs" add column if not exists "timeControl" jsonb;
alter table "chess_format_configs" add column if not exists "networkMode" text;
alter table "chess_format_configs" add column if not exists "blockedMode" jsonb;
alter table "chess_format_configs" add column if not exists "spectators" jsonb;
alter table "chess_format_configs" add column if not exists "status" text;
alter table "chess_format_configs" add column if not exists "locked" boolean;
alter table "chess_format_configs" add column if not exists "lockedAt" timestamptz;
alter table "chess_format_configs" add column if not exists "firstOfficialMatchId" text;
alter table "chess_format_configs" add column if not exists "validatedAt" timestamptz;
alter table "chess_format_configs" add column if not exists "createdBy" text;
alter table "chess_format_configs" add column if not exists "resetAt" timestamptz;
alter table "chess_format_pairings" add column if not exists "configId" text;
alter table "chess_format_pairings" add column if not exists "tournamentId" text;
alter table "chess_format_pairings" add column if not exists "round" numeric;
alter table "chess_format_pairings" add column if not exists "board" numeric;
alter table "chess_format_pairings" add column if not exists "whiteId" text;
alter table "chess_format_pairings" add column if not exists "blackId" text;
alter table "chess_format_pairings" add column if not exists "bye" boolean;
alter table "chess_format_pairings" add column if not exists "result" text;
alter table "chess_format_pairings" add column if not exists "resultSource" text;
alter table "chess_format_resets" add column if not exists "configId" text;
alter table "chess_format_resets" add column if not exists "tournamentId" text;
alter table "chess_format_resets" add column if not exists "reason" text;
alter table "chess_format_resets" add column if not exists "requestedBy" text;
alter table "chess_format_resets" add column if not exists "requestedAt" timestamptz;
alter table "chess_format_resets" add column if not exists "status" text;
alter table "chess_format_resets" add column if not exists "approvedBy" text;
alter table "chess_format_resets" add column if not exists "approvedAt" timestamptz;
alter table "chess_format_resets" add column if not exists "note" text;
alter table "chess_format_signals" add column if not exists "matchId" text;
alter table "chess_format_signals" add column if not exists "configId" text;
alter table "chess_format_signals" add column if not exists "type" text;
alter table "chess_format_signals" add column if not exists "detail" jsonb;
alter table "chess_format_signals" add column if not exists "severity" text;
alter table "chess_format_signals" add column if not exists "status" text;
alter table "chess_format_signals" add column if not exists "organizerAlerted" boolean;
alter table "chess_format_signals" add column if not exists "isProofOfCheating" boolean;
alter table "chess_format_signals" add column if not exists "automaticPenalty" boolean;
alter table "chess_format_signals" add column if not exists "penaltyId" text;
alter table "chess_format_signals" add column if not exists "recordedBy" text;
alter table "chess_format_signals" add column if not exists "at" text;
alter table "chess_format_signals" add column if not exists "decision" text;
alter table "chess_format_signals" add column if not exists "decisionReason" text;
alter table "chess_format_signals" add column if not exists "decidedBy" text;
alter table "chess_format_signals" add column if not exists "decidedAt" timestamptz;
alter table "chess_format_spectators" add column if not exists "matchId" text;
alter table "chess_format_spectators" add column if not exists "configId" text;
alter table "chess_format_spectators" add column if not exists "spectatorId" text;
alter table "chess_format_spectators" add column if not exists "requestedBy" text;
alter table "chess_format_spectators" add column if not exists "status" text;
alter table "chess_format_spectators" add column if not exists "readOnly" boolean;
alter table "chess_format_spectators" add column if not exists "delaySeconds" numeric;
alter table "chess_format_spectators" add column if not exists "approvedBy" text;
alter table "chess_format_spectators" add column if not exists "approvedAt" timestamptz;
alter table "chess_format_spectators" add column if not exists "revokedBy" text;
alter table "chess_format_spectators" add column if not exists "revokedAt" timestamptz;
alter table "chess_format_spectators" add column if not exists "revokeReason" text;
alter table "chess_governance_candidates" add column if not exists "electionId" text;
alter table "chess_governance_candidates" add column if not exists "userId" text;
alter table "chess_governance_candidates" add column if not exists "position" text;
alter table "chess_governance_candidates" add column if not exists "statement" text;
alter table "chess_governance_candidates" add column if not exists "proposedBy" text;
alter table "chess_governance_candidates" add column if not exists "status" text;
alter table "chess_governance_candidates" add column if not exists "eligibilityNotes" text;
alter table "chess_governance_candidates" add column if not exists "reviewedBy" text;
alter table "chess_governance_candidates" add column if not exists "reviewedAt" timestamptz;
alter table "chess_governance_candidates" add column if not exists "createdAt" timestamptz;
alter table "chess_governance_elections" add column if not exists "title" text;
alter table "chess_governance_elections" add column if not exists "positions" jsonb;
alter table "chess_governance_elections" add column if not exists "opensAt" timestamptz;
alter table "chess_governance_elections" add column if not exists "closesAt" timestamptz;
alter table "chess_governance_elections" add column if not exists "requiresInstitutionalApproval" boolean;
alter table "chess_governance_elections" add column if not exists "authorized" boolean;
alter table "chess_governance_elections" add column if not exists "authorizedBy" text;
alter table "chess_governance_elections" add column if not exists "authorizedAt" timestamptz;
alter table "chess_governance_elections" add column if not exists "authorizationRef" text;
alter table "chess_governance_elections" add column if not exists "status" text;
alter table "chess_governance_elections" add column if not exists "results" jsonb;
alter table "chess_governance_elections" add column if not exists "certified" boolean;
alter table "chess_governance_elections" add column if not exists "certifiedBy" text;
alter table "chess_governance_elections" add column if not exists "certifiedAt" timestamptz;
alter table "chess_governance_elections" add column if not exists "createdBy" text;
alter table "chess_governance_elections" add column if not exists "createdAt" timestamptz;
alter table "chess_governance_elections" add column if not exists "votingOpenedAt" timestamptz;
alter table "chess_governance_elections" add column if not exists "votingOpenedBy" text;
alter table "chess_governance_elections" add column if not exists "closedAt" timestamptz;
alter table "chess_governance_elections" add column if not exists "closedBy" text;
alter table "chess_governance_elections" add column if not exists "certificationNotes" text;
alter table "chess_governance_handover_tasks" add column if not exists "electionId" text;
alter table "chess_governance_handover_tasks" add column if not exists "title" text;
alter table "chess_governance_handover_tasks" add column if not exists "asset" text;
alter table "chess_governance_handover_tasks" add column if not exists "assigneeId" text;
alter table "chess_governance_handover_tasks" add column if not exists "status" text;
alter table "chess_governance_handover_tasks" add column if not exists "createdBy" text;
alter table "chess_governance_handover_tasks" add column if not exists "createdAt" timestamptz;
alter table "chess_governance_handover_tasks" add column if not exists "completedAt" timestamptz;
alter table "chess_governance_handover_tasks" add column if not exists "completedBy" text;
alter table "chess_governance_terms" add column if not exists "position" text;
alter table "chess_governance_terms" add column if not exists "userId" text;
alter table "chess_governance_terms" add column if not exists "holderName" text;
alter table "chess_governance_terms" add column if not exists "responsibilities" text;
alter table "chess_governance_terms" add column if not exists "startsAt" timestamptz;
alter table "chess_governance_terms" add column if not exists "endsAt" timestamptz;
alter table "chess_governance_terms" add column if not exists "status" text;
alter table "chess_governance_terms" add column if not exists "createdBy" text;
alter table "chess_governance_terms" add column if not exists "createdAt" timestamptz;
alter table "chess_governance_votes" add column if not exists "electionId" text;
alter table "chess_governance_votes" add column if not exists "voterId" text;
alter table "chess_governance_votes" add column if not exists "candidateId" text;
alter table "chess_governance_votes" add column if not exists "castAt" timestamptz;
alter table "chess_governance_votes" add column if not exists "ballotHash" text;
alter table "chess_integration_health_checks" add column if not exists "integrationId" text;
alter table "chess_integration_health_checks" add column if not exists "status" text;
alter table "chess_integration_health_checks" add column if not exists "latencyMs" numeric;
alter table "chess_integration_health_checks" add column if not exists "checkedBy" text;
alter table "chess_integration_health_checks" add column if not exists "createdAt" timestamptz;
alter table "chess_integration_registry" add column if not exists "provider" text;
alter table "chess_integration_registry" add column if not exists "category" text;
alter table "chess_integration_registry" add column if not exists "purpose" text;
alter table "chess_integration_registry" add column if not exists "ownerId" text;
alter table "chess_integration_registry" add column if not exists "dataScope" jsonb;
alter table "chess_integration_registry" add column if not exists "credentialRef" text;
alter table "chess_integration_registry" add column if not exists "permissionScopes" jsonb;
alter table "chess_integration_registry" add column if not exists "freeQuotaLimit" numeric;
alter table "chess_integration_registry" add column if not exists "quotaUnit" text;
alter table "chess_integration_registry" add column if not exists "currencyBudgetInr" text;
alter table "chess_integration_registry" add column if not exists "usageCount" numeric;
alter table "chess_integration_registry" add column if not exists "enabled" boolean;
alter table "chess_integration_registry" add column if not exists "healthStatus" text;
alter table "chess_integration_registry" add column if not exists "failurePolicy" text;
alter table "chess_integration_registry" add column if not exists "migrationPath" text;
alter table "chess_integration_registry" add column if not exists "termsReviewed" boolean;
alter table "chess_integration_registry" add column if not exists "termsReviewedBy" text;
alter table "chess_integration_registry" add column if not exists "termsReviewedAt" timestamptz;
alter table "chess_integration_registry" add column if not exists "lastVerifiedAt" timestamptz;
alter table "chess_integration_registry" add column if not exists "createdBy" text;
alter table "chess_integration_registry" add column if not exists "createdAt" timestamptz;
alter table "chess_integration_registry" add column if not exists "enabledAt" timestamptz;
alter table "chess_integration_registry" add column if not exists "disabledAt" timestamptz;
alter table "chess_integration_registry" add column if not exists "lastUsedAt" timestamptz;
alter table "chess_integration_registry" add column if not exists "lastError" text;
alter table "chess_integration_usage_events" add column if not exists "integrationId" text;
alter table "chess_integration_usage_events" add column if not exists "provider" text;
alter table "chess_integration_usage_events" add column if not exists "units" numeric;
alter table "chess_integration_usage_events" add column if not exists "kind" text;
alter table "chess_integration_usage_events" add column if not exists "actorId" text;
alter table "chess_integration_usage_events" add column if not exists "createdAt" timestamptz;
alter table "chess_interuniversity_competitions" add column if not exists "name" text;
alter table "chess_interuniversity_competitions" add column if not exists "federationId" text;
alter table "chess_interuniversity_competitions" add column if not exists "startsAt" timestamptz;
alter table "chess_interuniversity_competitions" add column if not exists "endsAt" timestamptz;
alter table "chess_interuniversity_competitions" add column if not exists "eligibility" text;
alter table "chess_interuniversity_competitions" add column if not exists "selectionCriteria" text;
alter table "chess_interuniversity_competitions" add column if not exists "externalUrl" text;
alter table "chess_interuniversity_competitions" add column if not exists "registrationStatus" text;
alter table "chess_interuniversity_competitions" add column if not exists "paymentProcessed" boolean;
alter table "chess_interuniversity_competitions" add column if not exists "status" text;
alter table "chess_interuniversity_competitions" add column if not exists "createdBy" text;
alter table "chess_interuniversity_competitions" add column if not exists "createdAt" timestamptz;
alter table "chess_interuniversity_documents" add column if not exists "competitionId" text;
alter table "chess_interuniversity_documents" add column if not exists "title" text;
alter table "chess_interuniversity_documents" add column if not exists "url" text;
alter table "chess_interuniversity_documents" add column if not exists "kind" text;
alter table "chess_interuniversity_documents" add column if not exists "restrictedTo" jsonb;
alter table "chess_interuniversity_documents" add column if not exists "createdBy" text;
alter table "chess_interuniversity_documents" add column if not exists "createdAt" timestamptz;
alter table "chess_interuniversity_federations" add column if not exists "name" text;
alter table "chess_interuniversity_federations" add column if not exists "contactName" text;
alter table "chess_interuniversity_federations" add column if not exists "contactEmail" text;
alter table "chess_interuniversity_federations" add column if not exists "website" text;
alter table "chess_interuniversity_federations" add column if not exists "verified" boolean;
alter table "chess_interuniversity_federations" add column if not exists "verifiedBy" text;
alter table "chess_interuniversity_federations" add column if not exists "verifiedAt" timestamptz;
alter table "chess_interuniversity_federations" add column if not exists "createdBy" text;
alter table "chess_interuniversity_federations" add column if not exists "createdAt" timestamptz;
alter table "chess_interuniversity_fixtures" add column if not exists "competitionId" text;
alter table "chess_interuniversity_fixtures" add column if not exists "federationId" text;
alter table "chess_interuniversity_fixtures" add column if not exists "round" numeric;
alter table "chess_interuniversity_fixtures" add column if not exists "opponentUniversity" text;
alter table "chess_interuniversity_fixtures" add column if not exists "homeAway" text;
alter table "chess_interuniversity_fixtures" add column if not exists "scheduledAt" timestamptz;
alter table "chess_interuniversity_fixtures" add column if not exists "venue" text;
alter table "chess_interuniversity_fixtures" add column if not exists "result" text;
alter table "chess_interuniversity_fixtures" add column if not exists "ourScore" numeric;
alter table "chess_interuniversity_fixtures" add column if not exists "opponentScore" numeric;
alter table "chess_interuniversity_fixtures" add column if not exists "resultStatus" text;
alter table "chess_interuniversity_fixtures" add column if not exists "proposedBy" text;
alter table "chess_interuniversity_fixtures" add column if not exists "proposedAt" timestamptz;
alter table "chess_interuniversity_fixtures" add column if not exists "confirmedBy" text;
alter table "chess_interuniversity_fixtures" add column if not exists "confirmedAt" timestamptz;
alter table "chess_interuniversity_fixtures" add column if not exists "createdBy" text;
alter table "chess_interuniversity_fixtures" add column if not exists "createdAt" timestamptz;
alter table "chess_interuniversity_teams" add column if not exists "competitionId" text;
alter table "chess_interuniversity_teams" add column if not exists "playerIds" jsonb;
alter table "chess_interuniversity_teams" add column if not exists "criteria" text;
alter table "chess_interuniversity_teams" add column if not exists "status" text;
alter table "chess_interuniversity_teams" add column if not exists "proposedBy" text;
alter table "chess_interuniversity_teams" add column if not exists "proposedAt" timestamptz;
alter table "chess_interuniversity_teams" add column if not exists "approvedBy" text;
alter table "chess_interuniversity_teams" add column if not exists "approvedAt" timestamptz;
alter table "chess_interuniversity_teams" add column if not exists "createdBy" text;
alter table "chess_interuniversity_teams" add column if not exists "createdAt" timestamptz;
alter table "chess_inventory_assets" add column if not exists "assetTag" text;
alter table "chess_inventory_assets" add column if not exists "name" text;
alter table "chess_inventory_assets" add column if not exists "category" text;
alter table "chess_inventory_assets" add column if not exists "description" text;
alter table "chess_inventory_assets" add column if not exists "source" text;
alter table "chess_inventory_assets" add column if not exists "acquiredAt" timestamptz;
alter table "chess_inventory_assets" add column if not exists "condition" text;
alter table "chess_inventory_assets" add column if not exists "location" text;
alter table "chess_inventory_assets" add column if not exists "custodianId" text;
alter table "chess_inventory_assets" add column if not exists "quantity" numeric;
alter table "chess_inventory_assets" add column if not exists "onLoan" numeric;
alter table "chess_inventory_assets" add column if not exists "damaged" numeric;
alter table "chess_inventory_assets" add column if not exists "lost" numeric;
alter table "chess_inventory_assets" add column if not exists "replacementValue" numeric;
alter table "chess_inventory_assets" add column if not exists "warrantyUntil" text;
alter table "chess_inventory_assets" add column if not exists "attachments" jsonb;
alter table "chess_inventory_assets" add column if not exists "status" text;
alter table "chess_inventory_assets" add column if not exists "disposalStatus" text;
alter table "chess_inventory_assets" add column if not exists "disposalRequestedBy" text;
alter table "chess_inventory_assets" add column if not exists "disposalReason" text;
alter table "chess_inventory_assets" add column if not exists "disposalApprovedBy" text;
alter table "chess_inventory_assets" add column if not exists "disposedAt" timestamptz;
alter table "chess_inventory_assets" add column if not exists "createdBy" text;
alter table "chess_inventory_assets" add column if not exists "createdAt" timestamptz;
alter table "chess_inventory_assets" add column if not exists "disposalRequestedAt" timestamptz;
alter table "chess_inventory_loans" add column if not exists "assetId" text;
alter table "chess_inventory_loans" add column if not exists "borrowerId" text;
alter table "chess_inventory_loans" add column if not exists "quantity" numeric;
alter table "chess_inventory_loans" add column if not exists "returnedQuantity" numeric;
alter table "chess_inventory_loans" add column if not exists "dueAt" timestamptz;
alter table "chess_inventory_loans" add column if not exists "status" text;
alter table "chess_inventory_loans" add column if not exists "checkedOutAt" timestamptz;
alter table "chess_inventory_loans" add column if not exists "checkedOutBy" text;
alter table "chess_inventory_loans" add column if not exists "returnedAt" timestamptz;
alter table "chess_inventory_loans" add column if not exists "returnedBy" text;
alter table "chess_inventory_loans" add column if not exists "returnCondition" text;
alter table "chess_inventory_movements" add column if not exists "assetId" text;
alter table "chess_inventory_movements" add column if not exists "kind" text;
alter table "chess_inventory_movements" add column if not exists "quantity" numeric;
alter table "chess_inventory_movements" add column if not exists "actorId" text;
alter table "chess_inventory_movements" add column if not exists "at" text;
alter table "chess_inventory_movements" add column if not exists "condition" text;
alter table "chess_inventory_movements" add column if not exists "note" text;
alter table "chess_inventory_movements" add column if not exists "borrowerId" text;
alter table "chess_kb_articles" add column if not exists "title" text;
alter table "chess_kb_articles" add column if not exists "body" text;
alter table "chess_kb_articles" add column if not exists "status" text;
alter table "chess_kb_articles" add column if not exists "createdAt" timestamptz;
alter table "chess_kb_articles" add column if not exists "slug" text;
alter table "chess_kb_articles" add column if not exists "summary" text;
alter table "chess_kb_articles" add column if not exists "category" text;
alter table "chess_kb_articles" add column if not exists "tags" jsonb;
alter table "chess_kb_articles" add column if not exists "audience" text;
alter table "chess_kb_articles" add column if not exists "visibility" text;
alter table "chess_kb_articles" add column if not exists "isPolicy" boolean;
alter table "chess_kb_articles" add column if not exists "external" boolean;
alter table "chess_kb_articles" add column if not exists "source" text;
alter table "chess_kb_articles" add column if not exists "licence" text;
alter table "chess_kb_articles" add column if not exists "ownerId" text;
alter table "chess_kb_articles" add column if not exists "version" numeric;
alter table "chess_kb_articles" add column if not exists "reviewDueAt" timestamptz;
alter table "chess_kb_articles" add column if not exists "publishedAt" timestamptz;
alter table "chess_kb_articles" add column if not exists "publishedBy" text;
alter table "chess_kb_articles" add column if not exists "archivedAt" timestamptz;
alter table "chess_kb_articles" add column if not exists "lastEditedBy" text;
alter table "chess_kb_articles" add column if not exists "lastEditedAt" timestamptz;
alter table "chess_kb_versions" add column if not exists "articleId" text;
alter table "chess_kb_versions" add column if not exists "version" numeric;
alter table "chess_kb_versions" add column if not exists "title" text;
alter table "chess_kb_versions" add column if not exists "body" text;
alter table "chess_kb_versions" add column if not exists "summary" text;
alter table "chess_kb_versions" add column if not exists "audience" text;
alter table "chess_kb_versions" add column if not exists "visibility" text;
alter table "chess_kb_versions" add column if not exists "status" text;
alter table "chess_kb_versions" add column if not exists "savedBy" text;
alter table "chess_kb_versions" add column if not exists "savedAt" timestamptz;
alter table "chess_marketing_campaigns" add column if not exists "title" text;
alter table "chess_marketing_campaigns" add column if not exists "channel" text;
alter table "chess_marketing_campaigns" add column if not exists "scheduledAt" timestamptz;
alter table "chess_marketing_campaigns" add column if not exists "brief" text;
alter table "chess_marketing_campaigns" add column if not exists "content" text;
alter table "chess_marketing_campaigns" add column if not exists "assetUrls" jsonb;
alter table "chess_marketing_campaigns" add column if not exists "identifiablePeople" boolean;
alter table "chess_marketing_campaigns" add column if not exists "consentGranted" boolean;
alter table "chess_marketing_campaigns" add column if not exists "consentEvidence" text;
alter table "chess_marketing_campaigns" add column if not exists "audience" text;
alter table "chess_marketing_campaigns" add column if not exists "transactional" boolean;
alter table "chess_marketing_campaigns" add column if not exists "status" text;
alter table "chess_marketing_campaigns" add column if not exists "externalUrl" text;
alter table "chess_marketing_campaigns" add column if not exists "publishedAt" timestamptz;
alter table "chess_marketing_campaigns" add column if not exists "publishedBy" text;
alter table "chess_marketing_campaigns" add column if not exists "approvedBy" text;
alter table "chess_marketing_campaigns" add column if not exists "rejectedReason" text;
alter table "chess_marketing_campaigns" add column if not exists "metrics" jsonb;
alter table "chess_marketing_campaigns" add column if not exists "createdBy" text;
alter table "chess_marketing_campaigns" add column if not exists "submittedAt" timestamptz;
alter table "chess_marketing_campaigns" add column if not exists "approvedAt" timestamptz;
alter table "chess_match_confirmations" add column if not exists "matchId" text;
alter table "chess_match_confirmations" add column if not exists "playerId" text;
alter table "chess_match_confirmations" add column if not exists "side" text;
alter table "chess_match_confirmations" add column if not exists "decision" text;
alter table "chess_match_confirmations" add column if not exists "note" text;
alter table "chess_match_confirmations" add column if not exists "at" text;
alter table "chess_match_disputes" add column if not exists "matchId" text;
alter table "chess_match_disputes" add column if not exists "raisedBy" text;
alter table "chess_match_disputes" add column if not exists "side" text;
alter table "chess_match_disputes" add column if not exists "reason" text;
alter table "chess_match_disputes" add column if not exists "status" text;
alter table "chess_match_disputes" add column if not exists "resolution" text;
alter table "chess_match_disputes" add column if not exists "resolvedBy" text;
alter table "chess_match_disputes" add column if not exists "resolvedAt" timestamptz;
alter table "chess_match_disputes" add column if not exists "at" text;
alter table "chess_match_events" add column if not exists "matchId" text;
alter table "chess_match_events" add column if not exists "action" text;
alter table "chess_match_events" add column if not exists "actorId" text;
alter table "chess_match_events" add column if not exists "detail" jsonb;
alter table "chess_match_events" add column if not exists "at" text;
alter table "chess_match_moves" add column if not exists "matchId" text;
alter table "chess_match_moves" add column if not exists "seq" numeric;
alter table "chess_match_moves" add column if not exists "side" text;
alter table "chess_match_moves" add column if not exists "playerId" text;
alter table "chess_match_moves" add column if not exists "san" text;
alter table "chess_match_moves" add column if not exists "from" text;
alter table "chess_match_moves" add column if not exists "to" text;
alter table "chess_match_moves" add column if not exists "promotion" text;
alter table "chess_match_moves" add column if not exists "clockAfterMs" numeric;
alter table "chess_match_moves" add column if not exists "at" text;
alter table "chess_match_rooms" add column if not exists "tournamentId" text;
alter table "chess_match_rooms" add column if not exists "whitePlayerId" text;
alter table "chess_match_rooms" add column if not exists "blackPlayerId" text;
alter table "chess_match_rooms" add column if not exists "round" numeric;
alter table "chess_match_rooms" add column if not exists "board" text;
alter table "chess_match_rooms" add column if not exists "timeControl" jsonb;
alter table "chess_match_rooms" add column if not exists "clock" jsonb;
alter table "chess_match_rooms" add column if not exists "status" text;
alter table "chess_match_rooms" add column if not exists "turn" text;
alter table "chess_match_rooms" add column if not exists "seq" numeric;
alter table "chess_match_rooms" add column if not exists "version" numeric;
alter table "chess_match_rooms" add column if not exists "checkedIn" jsonb;
alter table "chess_match_rooms" add column if not exists "lastMoveAt" timestamptz;
alter table "chess_match_rooms" add column if not exists "startedAt" timestamptz;
alter table "chess_match_rooms" add column if not exists "endedAt" timestamptz;
alter table "chess_match_rooms" add column if not exists "proposedResult" jsonb;
alter table "chess_match_rooms" add column if not exists "finalResult" text;
alter table "chess_match_rooms" add column if not exists "confirmedAt" timestamptz;
alter table "chess_match_rooms" add column if not exists "finalizedAt" timestamptz;
alter table "chess_match_rooms" add column if not exists "resolvedBy" text;
alter table "chess_match_rooms" add column if not exists "drawOffer" text;
alter table "chess_match_rooms" add column if not exists "clockExpired" boolean;
alter table "chess_match_rooms" add column if not exists "affectsRating" boolean;
alter table "chess_match_rooms" add column if not exists "ratingPipelineStatus" text;
alter table "chess_match_rooms" add column if not exists "spectatorEnabled" boolean;
alter table "chess_match_rooms" add column if not exists "spectatorDelaySeconds" numeric;
alter table "chess_match_rooms" add column if not exists "createdBy" text;
alter table "chess_match_rooms" add column if not exists "readyAt" timestamptz;
alter table "chess_match_rooms" add column if not exists "resolutionReason" text;
alter table "chess_match_rooms" add column if not exists "standingsUpdated" boolean;
alter table "chess_match_rooms" add column if not exists "disputedAt" timestamptz;
alter table "chess_match_rooms" add column if not exists "pausedAt" timestamptz;
alter table "chess_match_rooms" add column if not exists "pauseReason" text;
alter table "chess_match_rooms" add column if not exists "resumedAt" timestamptz;
alter table "chess_match_standings" add column if not exists "tournamentId" text;
alter table "chess_match_standings" add column if not exists "playerId" text;
alter table "chess_match_standings" add column if not exists "points" numeric;
alter table "chess_match_standings" add column if not exists "played" numeric;
alter table "chess_match_standings" add column if not exists "wins" numeric;
alter table "chess_match_standings" add column if not exists "draws" numeric;
alter table "chess_match_standings" add column if not exists "losses" numeric;
alter table "chess_match_standings" add column if not exists "lastMatchId" text;
alter table "chess_media_items" add column if not exists "title" text;
alter table "chess_media_items" add column if not exists "caption" text;
alter table "chess_media_items" add column if not exists "status" text;
alter table "chess_media_items" add column if not exists "archiveYear" numeric;
alter table "chess_media_items" add column if not exists "tags" jsonb;
alter table "chess_media_items" add column if not exists "createdAt" timestamptz;
alter table "chess_media_items" add column if not exists "albumId" text;
alter table "chess_media_items" add column if not exists "eventDate" timestamptz;
alter table "chess_media_items" add column if not exists "sourceOwner" text;
alter table "chess_media_items" add column if not exists "licence" text;
alter table "chess_media_items" add column if not exists "sourceUrl" text;
alter table "chess_media_items" add column if not exists "mediaType" text;
alter table "chess_media_items" add column if not exists "externalUrl" text;
alter table "chess_media_items" add column if not exists "identifiablePeople" boolean;
alter table "chess_media_items" add column if not exists "consentStatus" text;
alter table "chess_media_items" add column if not exists "consentRecordedAt" timestamptz;
alter table "chess_media_items" add column if not exists "storageBytes" numeric;
alter table "chess_media_items" add column if not exists "downloadRestricted" boolean;
alter table "chess_media_items" add column if not exists "publishedAt" timestamptz;
alter table "chess_media_items" add column if not exists "moderationNote" text;
alter table "chess_media_items" add column if not exists "contributorId" text;
alter table "chess_media_items" add column if not exists "consentEvidence" text;
alter table "chess_media_items" add column if not exists "consentRecordedBy" text;
alter table "chess_media_items" add column if not exists "approvedBy" text;
alter table "chess_media_items" add column if not exists "approvedAt" timestamptz;
alter table "chess_media_items" add column if not exists "publishedBy" text;
alter table "chess_media_items" add column if not exists "removedAt" timestamptz;
alter table "chess_media_items" add column if not exists "removedBy" text;
alter table "chess_media_items" add column if not exists "removalReason" text;
alter table "chess_media_takedown_requests" add column if not exists "mediaId" text;
alter table "chess_media_takedown_requests" add column if not exists "requesterId" text;
alter table "chess_media_takedown_requests" add column if not exists "reason" text;
alter table "chess_media_takedown_requests" add column if not exists "contact" text;
alter table "chess_media_takedown_requests" add column if not exists "status" text;
alter table "chess_media_takedown_requests" add column if not exists "raisedAt" timestamptz;
alter table "chess_media_takedown_requests" add column if not exists "resolvedBy" text;
alter table "chess_media_takedown_requests" add column if not exists "resolvedAt" timestamptz;
alter table "chess_membership_applications" add column if not exists "applicantId" text;
alter table "chess_membership_applications" add column if not exists "applicantType" text;
alter table "chess_membership_applications" add column if not exists "categoryCode" text;
alter table "chess_membership_applications" add column if not exists "mode" text;
alter table "chess_membership_applications" add column if not exists "email" text;
alter table "chess_membership_applications" add column if not exists "status" text;
alter table "chess_membership_applications" add column if not exists "eligibilityStatus" text;
alter table "chess_membership_applications" add column if not exists "eligibilityReason" text;
alter table "chess_membership_applications" add column if not exists "termsAcceptedAt" timestamptz;
alter table "chess_membership_applications" add column if not exists "submittedAt" timestamptz;
alter table "chess_membership_applications" add column if not exists "decidedBy" text;
alter table "chess_membership_applications" add column if not exists "decidedAt" timestamptz;
alter table "chess_membership_applications" add column if not exists "decisionReason" text;
alter table "chess_membership_applications" add column if not exists "infoRequestedReason" text;
alter table "chess_membership_applications" add column if not exists "effectiveFrom" text;
alter table "chess_membership_applications" add column if not exists "effectiveTo" text;
alter table "chess_membership_applications" add column if not exists "createdAt" timestamptz;
alter table "chess_membership_categories" add column if not exists "code" text;
alter table "chess_membership_categories" add column if not exists "name" text;
alter table "chess_membership_categories" add column if not exists "mode" text;
alter table "chess_membership_categories" add column if not exists "active" boolean;
alter table "chess_membership_categories" add column if not exists "createdBy" text;
alter table "chess_membership_categories" add column if not exists "createdAt" timestamptz;
alter table "chess_notice_versions" add column if not exists "noticeId" text;
alter table "chess_notice_versions" add column if not exists "version" numeric;
alter table "chess_notice_versions" add column if not exists "title" text;
alter table "chess_notice_versions" add column if not exists "body" text;
alter table "chess_notice_versions" add column if not exists "category" text;
alter table "chess_notice_versions" add column if not exists "audience" jsonb;
alter table "chess_notice_versions" add column if not exists "priority" text;
alter table "chess_notice_versions" add column if not exists "reason" text;
alter table "chess_notice_versions" add column if not exists "recordedBy" text;
alter table "chess_notice_versions" add column if not exists "recordedAt" timestamptz;
alter table "chess_notices" add column if not exists "title" text;
alter table "chess_notices" add column if not exists "body" text;
alter table "chess_notices" add column if not exists "status" text;
alter table "chess_notices" add column if not exists "visibility" text;
alter table "chess_notices" add column if not exists "createdAt" timestamptz;
alter table "chess_notices" add column if not exists "category" text;
alter table "chess_notices" add column if not exists "audience" jsonb;
alter table "chess_notices" add column if not exists "priority" text;
alter table "chess_notices" add column if not exists "pinned" boolean;
alter table "chess_notices" add column if not exists "publishAt" timestamptz;
alter table "chess_notices" add column if not exists "expiresAt" timestamptz;
alter table "chess_notices" add column if not exists "requiresApproval" boolean;
alter table "chess_notices" add column if not exists "version" numeric;
alter table "chess_notices" add column if not exists "createdBy" text;
alter table "chess_notices" add column if not exists "submittedAt" timestamptz;
alter table "chess_notices" add column if not exists "approvedBy" text;
alter table "chess_notices" add column if not exists "approvedAt" timestamptz;
alter table "chess_notices" add column if not exists "publishedBy" text;
alter table "chess_notices" add column if not exists "publishedAt" timestamptz;
alter table "chess_notices" add column if not exists "archivedAt" timestamptz;
alter table "chess_notices" add column if not exists "correctedAt" timestamptz;
alter table "chess_notices" add column if not exists "correctedBy" text;
alter table "chess_notices" add column if not exists "correctionReason" text;
alter table "chess_notices" add column if not exists "unpublishedAt" timestamptz;
alter table "chess_notices" add column if not exists "unpublishReason" text;
alter table "chess_ops_alert_config" add column if not exists "key" text;
alter table "chess_ops_alert_config" add column if not exists "value" jsonb;
alter table "chess_ops_alert_config" add column if not exists "updatedBy" text;
alter table "chess_ops_alert_config" add column if not exists "updatedAt" timestamptz;
alter table "chess_ops_alert_config" add column if not exists "createdAt" timestamptz;
alter table "chess_ops_alerts" add column if not exists "category" text;
alter table "chess_ops_alerts" add column if not exists "severity" text;
alter table "chess_ops_alerts" add column if not exists "title" text;
alter table "chess_ops_alerts" add column if not exists "detail" text;
alter table "chess_ops_alerts" add column if not exists "ownerRole" text;
alter table "chess_ops_alerts" add column if not exists "sensitive" boolean;
alter table "chess_ops_alerts" add column if not exists "dedupeKey" text;
alter table "chess_ops_alerts" add column if not exists "escalationPath" jsonb;
alter table "chess_ops_alerts" add column if not exists "escalationLevel" numeric;
alter table "chess_ops_alerts" add column if not exists "escalatedTo" text;
alter table "chess_ops_alerts" add column if not exists "escalatedAt" timestamptz;
alter table "chess_ops_alerts" add column if not exists "ackDueAt" timestamptz;
alter table "chess_ops_alerts" add column if not exists "acknowledgedBy" text;
alter table "chess_ops_alerts" add column if not exists "acknowledgedAt" timestamptz;
alter table "chess_ops_alerts" add column if not exists "status" text;
alter table "chess_ops_alerts" add column if not exists "occurrenceCount" numeric;
alter table "chess_ops_alerts" add column if not exists "lastSeenAt" timestamptz;
alter table "chess_ops_alerts" add column if not exists "resolvedBy" text;
alter table "chess_ops_alerts" add column if not exists "resolvedAt" timestamptz;
alter table "chess_ops_alerts" add column if not exists "resolutionNote" text;
alter table "chess_ops_alerts" add column if not exists "createdBy" text;
alter table "chess_ops_alerts" add column if not exists "createdAt" timestamptz;
alter table "chess_ops_task_dependencies" add column if not exists "taskId" text;
alter table "chess_ops_task_dependencies" add column if not exists "dependsOnId" text;
alter table "chess_ops_task_dependencies" add column if not exists "createdBy" text;
alter table "chess_ops_task_dependencies" add column if not exists "createdAt" timestamptz;
alter table "chess_ops_task_events" add column if not exists "taskId" text;
alter table "chess_ops_task_events" add column if not exists "from" text;
alter table "chess_ops_task_events" add column if not exists "to" text;
alter table "chess_ops_task_events" add column if not exists "actorId" text;
alter table "chess_ops_task_events" add column if not exists "note" text;
alter table "chess_ops_task_events" add column if not exists "at" text;
alter table "chess_ops_tasks" add column if not exists "title" text;
alter table "chess_ops_tasks" add column if not exists "assigneeId" text;
alter table "chess_ops_tasks" add column if not exists "status" text;
alter table "chess_ops_tasks" add column if not exists "priority" text;
alter table "chess_ops_tasks" add column if not exists "dueDate" timestamptz;
alter table "chess_ops_tasks" add column if not exists "createdAt" timestamptz;
alter table "chess_ops_tasks" add column if not exists "description" text;
alter table "chess_ops_tasks" add column if not exists "scope" text;
alter table "chess_ops_tasks" add column if not exists "projectId" text;
alter table "chess_ops_tasks" add column if not exists "sensitive" boolean;
alter table "chess_ops_tasks" add column if not exists "checklist" jsonb;
alter table "chess_ops_tasks" add column if not exists "evidence" text;
alter table "chess_ops_tasks" add column if not exists "submittedAt" timestamptz;
alter table "chess_ops_tasks" add column if not exists "closedAt" timestamptz;
alter table "chess_ops_tasks" add column if not exists "reviewedBy" text;
alter table "chess_ops_tasks" add column if not exists "createdBy" text;
alter table "chess_ops_tasks" add column if not exists "reviewNote" text;
alter table "chess_player_profiles" add column if not exists "userId" text;
alter table "chess_player_profiles" add column if not exists "displayName" text;
alter table "chess_player_profiles" add column if not exists "clubId" text;
alter table "chess_player_profiles" add column if not exists "contactEmail" text;
alter table "chess_player_profiles" add column if not exists "department" text;
alter table "chess_player_profiles" add column if not exists "departmentVerified" boolean;
alter table "chess_player_profiles" add column if not exists "bulletRating" numeric;
alter table "chess_player_profiles" add column if not exists "blitzRating" numeric;
alter table "chess_player_profiles" add column if not exists "rapidRating" numeric;
alter table "chess_player_profiles" add column if not exists "bulletPeak" numeric;
alter table "chess_player_profiles" add column if not exists "blitzPeak" numeric;
alter table "chess_player_profiles" add column if not exists "rapidPeak" numeric;
alter table "chess_player_profiles" add column if not exists "bulletGames" numeric;
alter table "chess_player_profiles" add column if not exists "blitzGames" numeric;
alter table "chess_player_profiles" add column if not exists "rapidGames" numeric;
alter table "chess_player_profiles" add column if not exists "gamesPlayed" numeric;
alter table "chess_player_profiles" add column if not exists "wins" numeric;
alter table "chess_player_profiles" add column if not exists "draws" numeric;
alter table "chess_player_profiles" add column if not exists "losses" numeric;
alter table "chess_player_profiles" add column if not exists "membershipStatus" text;
alter table "chess_player_profiles" add column if not exists "hasOpenDispute" boolean;
alter table "chess_player_profiles" add column if not exists "privacy" jsonb;
alter table "chess_player_profiles" add column if not exists "achievements" jsonb;
alter table "chess_player_profiles" add column if not exists "certificates" jsonb;
alter table "chess_player_profiles" add column if not exists "tournamentHistory" jsonb;
alter table "chess_player_profiles" add column if not exists "createdAt" timestamptz;
alter table "chess_qa_incidents" add column if not exists "title" text;
alter table "chess_qa_incidents" add column if not exists "severity" text;
alter table "chess_qa_incidents" add column if not exists "detail" text;
alter table "chess_qa_incidents" add column if not exists "status" text;
alter table "chess_qa_incidents" add column if not exists "openedBy" text;
alter table "chess_qa_incidents" add column if not exists "resolvedBy" text;
alter table "chess_qa_incidents" add column if not exists "resolvedAt" timestamptz;
alter table "chess_qa_incidents" add column if not exists "createdAt" timestamptz;
alter table "chess_qa_incidents" add column if not exists "resolution" text;
alter table "chess_qa_metrics" add column if not exists "name" text;
alter table "chess_qa_metrics" add column if not exists "value" numeric;
alter table "chess_qa_metrics" add column if not exists "unit" text;
alter table "chess_qa_metrics" add column if not exists "kind" text;
alter table "chess_qa_metrics" add column if not exists "route" text;
alter table "chess_qa_metrics" add column if not exists "recordedBy" text;
alter table "chess_qa_metrics" add column if not exists "createdAt" timestamptz;
alter table "chess_qa_performance_budgets" add column if not exists "flow" text;
alter table "chess_qa_performance_budgets" add column if not exists "p95Ms" numeric;
alter table "chess_qa_performance_budgets" add column if not exists "errorRatePct" numeric;
alter table "chess_qa_performance_budgets" add column if not exists "notes" text;
alter table "chess_qa_performance_budgets" add column if not exists "createdBy" text;
alter table "chess_qa_performance_budgets" add column if not exists "createdAt" timestamptz;
alter table "chess_qa_release_gates" add column if not exists "version" text;
alter table "chess_qa_release_gates" add column if not exists "status" text;
alter table "chess_qa_release_gates" add column if not exists "blockers" jsonb;
alter table "chess_qa_release_gates" add column if not exists "totalPassed" numeric;
alter table "chess_qa_release_gates" add column if not exists "totalFailed" numeric;
alter table "chess_qa_release_gates" add column if not exists "accessibilityViolations" numeric;
alter table "chess_qa_release_gates" add column if not exists "testRunIds" jsonb;
alter table "chess_qa_release_gates" add column if not exists "evaluatedBy" text;
alter table "chess_qa_release_gates" add column if not exists "createdAt" timestamptz;
alter table "chess_qa_release_gates" add column if not exists "releasedAt" timestamptz;
alter table "chess_qa_test_runs" add column if not exists "suite" text;
alter table "chess_qa_test_runs" add column if not exists "passed" numeric;
alter table "chess_qa_test_runs" add column if not exists "failed" numeric;
alter table "chess_qa_test_runs" add column if not exists "skipped" numeric;
alter table "chess_qa_test_runs" add column if not exists "total" numeric;
alter table "chess_qa_test_runs" add column if not exists "durationMs" numeric;
alter table "chess_qa_test_runs" add column if not exists "accessibility" jsonb;
alter table "chess_qa_test_runs" add column if not exists "devices" jsonb;
alter table "chess_qa_test_runs" add column if not exists "loadTest" boolean;
alter table "chess_qa_test_runs" add column if not exists "providerCompliant" boolean;
alter table "chess_qa_test_runs" add column if not exists "status" text;
alter table "chess_qa_test_runs" add column if not exists "runBy" text;
alter table "chess_qa_test_runs" add column if not exists "createdAt" timestamptz;
alter table "chess_rated_results" add column if not exists "sourceResultId" text;
alter table "chess_rated_results" add column if not exists "pool" text;
alter table "chess_rated_results" add column if not exists "whiteId" text;
alter table "chess_rated_results" add column if not exists "blackId" text;
alter table "chess_rated_results" add column if not exists "result" text;
alter table "chess_rated_results" add column if not exists "kind" text;
alter table "chess_rated_results" add column if not exists "tournamentId" text;
alter table "chess_rated_results" add column if not exists "appliedBy" text;
alter table "chess_rated_results" add column if not exists "appliedAt" timestamptz;
alter table "chess_rating_corrections" add column if not exists "userId" text;
alter table "chess_rating_corrections" add column if not exists "pool" text;
alter table "chess_rating_corrections" add column if not exists "before" numeric;
alter table "chess_rating_corrections" add column if not exists "newRating" numeric;
alter table "chess_rating_corrections" add column if not exists "reason" text;
alter table "chess_rating_corrections" add column if not exists "requestedBy" text;
alter table "chess_rating_corrections" add column if not exists "status" text;
alter table "chess_rating_corrections" add column if not exists "createdAt" timestamptz;
alter table "chess_rating_history" add column if not exists "userId" text;
alter table "chess_rating_history" add column if not exists "pool" text;
alter table "chess_rating_history" add column if not exists "before" numeric;
alter table "chess_rating_history" add column if not exists "after" numeric;
alter table "chess_rating_history" add column if not exists "delta" numeric;
alter table "chess_rating_history" add column if not exists "kind" text;
alter table "chess_rating_history" add column if not exists "sourceResultId" text;
alter table "chess_rating_history" add column if not exists "opponentId" text;
alter table "chess_rating_history" add column if not exists "result" text;
alter table "chess_rating_history" add column if not exists "at" text;
alter table "chess_rating_history" add column if not exists "correctionId" text;
alter table "chess_rating_history" add column if not exists "reason" text;
alter table "chess_rating_history" add column if not exists "actorId" text;
alter table "chess_recovery_contacts" add column if not exists "role" text;
alter table "chess_recovery_contacts" add column if not exists "name" text;
alter table "chess_recovery_contacts" add column if not exists "contact" text;
alter table "chess_recovery_contacts" add column if not exists "backupName" text;
alter table "chess_recovery_contacts" add column if not exists "active" boolean;
alter table "chess_recovery_contacts" add column if not exists "createdBy" text;
alter table "chess_recovery_contacts" add column if not exists "createdAt" timestamptz;
alter table "chess_recovery_continuity_events" add column if not exists "tournamentId" text;
alter table "chess_recovery_continuity_events" add column if not exists "reason" text;
alter table "chess_recovery_continuity_events" add column if not exists "mode" text;
alter table "chess_recovery_continuity_events" add column if not exists "status" text;
alter table "chess_recovery_continuity_events" add column if not exists "preservedStateRef" text;
alter table "chess_recovery_continuity_events" add column if not exists "walkoverAwarded" boolean;
alter table "chess_recovery_continuity_events" add column if not exists "manualDecisionRecorded" boolean;
alter table "chess_recovery_continuity_events" add column if not exists "reconcileRequired" boolean;
alter table "chess_recovery_continuity_events" add column if not exists "pausedBy" text;
alter table "chess_recovery_continuity_events" add column if not exists "pausedAt" timestamptz;
alter table "chess_recovery_continuity_events" add column if not exists "createdAt" timestamptz;
alter table "chess_recovery_continuity_events" add column if not exists "reconciliationNote" text;
alter table "chess_recovery_continuity_events" add column if not exists "reconciledBy" text;
alter table "chess_recovery_continuity_events" add column if not exists "reconciledAt" timestamptz;
alter table "chess_recovery_drills" add column if not exists "planId" text;
alter table "chess_recovery_drills" add column if not exists "outcome" text;
alter table "chess_recovery_drills" add column if not exists "actualRtoMinutes" numeric;
alter table "chess_recovery_drills" add column if not exists "actualRpoMinutes" numeric;
alter table "chess_recovery_drills" add column if not exists "targetRtoMinutes" numeric;
alter table "chess_recovery_drills" add column if not exists "targetRpoMinutes" numeric;
alter table "chess_recovery_drills" add column if not exists "rtoBreached" boolean;
alter table "chess_recovery_drills" add column if not exists "rpoBreached" boolean;
alter table "chess_recovery_drills" add column if not exists "lessons" text;
alter table "chess_recovery_drills" add column if not exists "improvements" jsonb;
alter table "chess_recovery_drills" add column if not exists "improvementCount" numeric;
alter table "chess_recovery_drills" add column if not exists "drilledBy" text;
alter table "chess_recovery_drills" add column if not exists "drilledAt" timestamptz;
alter table "chess_recovery_drills" add column if not exists "createdAt" timestamptz;
alter table "chess_recovery_plans" add column if not exists "name" text;
alter table "chess_recovery_plans" add column if not exists "scope" text;
alter table "chess_recovery_plans" add column if not exists "rpoMinutes" numeric;
alter table "chess_recovery_plans" add column if not exists "rtoMinutes" numeric;
alter table "chess_recovery_plans" add column if not exists "evidenceRef" text;
alter table "chess_recovery_plans" add column if not exists "evidenceTestedAt" timestamptz;
alter table "chess_recovery_plans" add column if not exists "priorities" jsonb;
alter table "chess_recovery_plans" add column if not exists "status" text;
alter table "chess_recovery_plans" add column if not exists "drillLog" jsonb;
alter table "chess_recovery_plans" add column if not exists "lastDrillAt" timestamptz;
alter table "chess_recovery_plans" add column if not exists "rtoBreached" boolean;
alter table "chess_recovery_plans" add column if not exists "approvedBy" text;
alter table "chess_recovery_plans" add column if not exists "approvedAt" timestamptz;
alter table "chess_recovery_plans" add column if not exists "createdBy" text;
alter table "chess_recovery_plans" add column if not exists "createdAt" timestamptz;
alter table "chess_recovery_plans" add column if not exists "approvalNote" text;
alter table "chess_recovery_plans" add column if not exists "lastActualRtoMinutes" numeric;
alter table "chess_report_exports" add column if not exists "reportKey" text;
alter table "chess_report_exports" add column if not exists "requestedBy" text;
alter table "chess_report_exports" add column if not exists "generatedAt" timestamptz;
alter table "chess_report_exports" add column if not exists "status" text;
alter table "chess_report_exports" add column if not exists "rowCount" numeric;
alter table "chess_report_exports" add column if not exists "format" text;
alter table "chess_report_exports" add column if not exists "limitations" jsonb;
alter table "chess_report_exports" add column if not exists "createdAt" timestamptz;
alter table "chess_search_queries" add column if not exists "userId" text;
alter table "chess_search_queries" add column if not exists "q" text;
alter table "chess_search_queries" add column if not exists "resultCount" numeric;
alter table "chess_search_queries" add column if not exists "createdAt" timestamptz;
alter table "chess_season_points" add column if not exists "seasonId" text;
alter table "chess_season_points" add column if not exists "userId" text;
alter table "chess_season_points" add column if not exists "resultId" text;
alter table "chess_season_points" add column if not exists "outcome" text;
alter table "chess_season_points" add column if not exists "points" numeric;
alter table "chess_season_points" add column if not exists "tournamentId" text;
alter table "chess_season_points" add column if not exists "recordedBy" text;
alter table "chess_season_points" add column if not exists "recordedAt" timestamptz;
alter table "chess_season_rating_entries" add column if not exists "seasonId" text;
alter table "chess_season_rating_entries" add column if not exists "userId" text;
alter table "chess_season_rating_entries" add column if not exists "pool" text;
alter table "chess_season_rating_entries" add column if not exists "startRating" numeric;
alter table "chess_season_rating_entries" add column if not exists "endRating" numeric;
alter table "chess_season_rating_entries" add column if not exists "games" numeric;
alter table "chess_season_rating_entries" add column if not exists "recordedBy" text;
alter table "chess_season_rating_entries" add column if not exists "recordedAt" timestamptz;
alter table "chess_security_alerts" add column if not exists "title" text;
alter table "chess_security_alerts" add column if not exists "signal" text;
alter table "chess_security_alerts" add column if not exists "severity" text;
alter table "chess_security_alerts" add column if not exists "ownerId" text;
alter table "chess_security_alerts" add column if not exists "status" text;
alter table "chess_security_alerts" add column if not exists "advisoryOnly" boolean;
alter table "chess_security_alerts" add column if not exists "conclusiveCheating" boolean;
alter table "chess_security_alerts" add column if not exists "requiresHumanReview" boolean;
alter table "chess_security_alerts" add column if not exists "raisedBy" text;
alter table "chess_security_alerts" add column if not exists "raisedAt" timestamptz;
alter table "chess_security_alerts" add column if not exists "createdAt" timestamptz;
alter table "chess_security_alerts" add column if not exists "escalatedAt" timestamptz;
alter table "chess_security_alerts" add column if not exists "incidentId" text;
alter table "chess_security_blocked_users" add column if not exists "ownerId" text;
alter table "chess_security_blocked_users" add column if not exists "blockedUserId" text;
alter table "chess_security_blocked_users" add column if not exists "createdAt" timestamptz;
alter table "chess_security_events" add column if not exists "userId" text;
alter table "chess_security_events" add column if not exists "type" text;
alter table "chess_security_events" add column if not exists "detail" jsonb;
alter table "chess_security_events" add column if not exists "createdAt" timestamptz;
alter table "chess_security_incidents" add column if not exists "title" text;
alter table "chess_security_incidents" add column if not exists "severity" text;
alter table "chess_security_incidents" add column if not exists "category" text;
alter table "chess_security_incidents" add column if not exists "ownerId" text;
alter table "chess_security_incidents" add column if not exists "status" text;
alter table "chess_security_incidents" add column if not exists "containmentStatus" text;
alter table "chess_security_incidents" add column if not exists "evidenceRefs" jsonb;
alter table "chess_security_incidents" add column if not exists "timeline" jsonb;
alter table "chess_security_incidents" add column if not exists "lessons" text;
alter table "chess_security_incidents" add column if not exists "detectedAt" timestamptz;
alter table "chess_security_incidents" add column if not exists "containedAt" timestamptz;
alter table "chess_security_incidents" add column if not exists "closedAt" timestamptz;
alter table "chess_security_incidents" add column if not exists "createdBy" text;
alter table "chess_security_incidents" add column if not exists "createdAt" timestamptz;
alter table "chess_security_incidents" add column if not exists "sourceAlertId" text;
alter table "chess_security_incidents" add column if not exists "advisoryOnly" boolean;
alter table "chess_security_login_attempts" add column if not exists "email" text;
alter table "chess_security_login_attempts" add column if not exists "failures" numeric;
alter table "chess_security_login_attempts" add column if not exists "lockedUntil" text;
alter table "chess_security_login_attempts" add column if not exists "lastFailureAt" timestamptz;
alter table "chess_security_login_attempts" add column if not exists "createdAt" timestamptz;
alter table "chess_security_mfa" add column if not exists "userId" text;
alter table "chess_security_mfa" add column if not exists "enabled" boolean;
alter table "chess_security_mfa" add column if not exists "method" text;
alter table "chess_security_mfa" add column if not exists "enabledAt" timestamptz;
alter table "chess_security_mfa" add column if not exists "disabledAt" timestamptz;
alter table "chess_security_mfa" add column if not exists "recoveryCodesIssued" numeric;
alter table "chess_security_mfa" add column if not exists "createdAt" timestamptz;
alter table "chess_security_privacy_settings" add column if not exists "userId" text;
alter table "chess_security_privacy_settings" add column if not exists "profileVisibility" text;
alter table "chess_security_privacy_settings" add column if not exists "showEmail" boolean;
alter table "chess_security_privacy_settings" add column if not exists "showRating" boolean;
alter table "chess_security_privacy_settings" add column if not exists "showRealName" boolean;
alter table "chess_security_privacy_settings" add column if not exists "allowDirectMessages" boolean;
alter table "chess_security_privacy_settings" add column if not exists "consentMarketing" boolean;
alter table "chess_security_privacy_settings" add column if not exists "consentAnalytics" boolean;
alter table "chess_security_privacy_settings" add column if not exists "createdAt" timestamptz;
alter table "chess_security_privacy_settings" add column if not exists "updatedAt" timestamptz;
alter table "chess_security_privileged_reviews" add column if not exists "accountId" text;
alter table "chess_security_privileged_reviews" add column if not exists "outcome" text;
alter table "chess_security_privileged_reviews" add column if not exists "notes" text;
alter table "chess_security_privileged_reviews" add column if not exists "reviewedBy" text;
alter table "chess_security_privileged_reviews" add column if not exists "reviewedAt" timestamptz;
alter table "chess_security_privileged_reviews" add column if not exists "createdAt" timestamptz;
alter table "chess_security_requests" add column if not exists "userId" text;
alter table "chess_security_requests" add column if not exists "type" text;
alter table "chess_security_requests" add column if not exists "detail" text;
alter table "chess_security_requests" add column if not exists "status" text;
alter table "chess_security_requests" add column if not exists "reviewerId" text;
alter table "chess_security_requests" add column if not exists "decidedAt" timestamptz;
alter table "chess_security_requests" add column if not exists "note" text;
alter table "chess_security_requests" add column if not exists "retentionReviewRequired" boolean;
alter table "chess_security_requests" add column if not exists "createdAt" timestamptz;
alter table "chess_security_requests" add column if not exists "handedToGovernance" boolean;
alter table "chess_security_secret_rotations" add column if not exists "name" text;
alter table "chess_security_secret_rotations" add column if not exists "reason" text;
alter table "chess_security_secret_rotations" add column if not exists "rotatedBy" text;
alter table "chess_security_secret_rotations" add column if not exists "rotatedAt" timestamptz;
alter table "chess_security_secret_rotations" add column if not exists "previousRotatedAt" timestamptz;
alter table "chess_security_secret_rotations" add column if not exists "storedValue" text;
alter table "chess_security_secret_rotations" add column if not exists "createdAt" timestamptz;
alter table "chess_security_session_revocations" add column if not exists "sessionId" text;
alter table "chess_security_session_revocations" add column if not exists "userId" text;
alter table "chess_security_session_revocations" add column if not exists "revokedBy" text;
alter table "chess_security_session_revocations" add column if not exists "revokedAt" timestamptz;
alter table "chess_security_session_revocations" add column if not exists "channels" jsonb;
alter table "chess_security_session_revocations" add column if not exists "createdAt" timestamptz;
alter table "chess_security_vulnerabilities" add column if not exists "component" text;
alter table "chess_security_vulnerabilities" add column if not exists "advisoryRef" text;
alter table "chess_security_vulnerabilities" add column if not exists "severity" text;
alter table "chess_security_vulnerabilities" add column if not exists "status" text;
alter table "chess_security_vulnerabilities" add column if not exists "ownerId" text;
alter table "chess_security_vulnerabilities" add column if not exists "remediationRef" text;
alter table "chess_security_vulnerabilities" add column if not exists "remediatedAt" timestamptz;
alter table "chess_security_vulnerabilities" add column if not exists "createdAt" timestamptz;
alter table "chess_security_vulnerabilities" add column if not exists "remediatedBy" text;
alter table "chess_sessions" add column if not exists "userId" text;
alter table "chess_sessions" add column if not exists "token" text;
alter table "chess_sessions" add column if not exists "expiresAt" timestamptz;
alter table "chess_sessions" add column if not exists "revokedAt" timestamptz;
alter table "chess_sessions" add column if not exists "createdAt" timestamptz;
alter table "chess_site_blocks" add column if not exists "kind" text;
alter table "chess_site_blocks" add column if not exists "title" text;
alter table "chess_site_blocks" add column if not exists "summary" text;
alter table "chess_site_blocks" add column if not exists "body" text;
alter table "chess_site_blocks" add column if not exists "heroImageUrl" text;
alter table "chess_site_blocks" add column if not exists "links" jsonb;
alter table "chess_site_blocks" add column if not exists "contact" jsonb;
alter table "chess_site_blocks" add column if not exists "seo" jsonb;
alter table "chess_site_blocks" add column if not exists "internalNotes" text;
alter table "chess_site_blocks" add column if not exists "status" text;
alter table "chess_site_blocks" add column if not exists "version" numeric;
alter table "chess_site_blocks" add column if not exists "supersedesId" text;
alter table "chess_site_blocks" add column if not exists "authorId" text;
alter table "chess_site_blocks" add column if not exists "reviewerId" text;
alter table "chess_site_blocks" add column if not exists "approvedBy" text;
alter table "chess_site_blocks" add column if not exists "publishedAt" timestamptz;
alter table "chess_site_blocks" add column if not exists "archivedAt" timestamptz;
alter table "chess_site_blocks" add column if not exists "isFirstOfKind" boolean;
alter table "chess_site_blocks" add column if not exists "submittedAt" timestamptz;
alter table "chess_site_blocks" add column if not exists "approvedAt" timestamptz;
alter table "chess_site_blocks" add column if not exists "publishedBy" text;
alter table "chess_sponsor_agreements" add column if not exists "partnerId" text;
alter table "chess_sponsor_agreements" add column if not exists "title" text;
alter table "chess_sponsor_agreements" add column if not exists "committedAmount" numeric;
alter table "chess_sponsor_agreements" add column if not exists "currency" text;
alter table "chess_sponsor_agreements" add column if not exists "startsAt" timestamptz;
alter table "chess_sponsor_agreements" add column if not exists "endsAt" timestamptz;
alter table "chess_sponsor_agreements" add column if not exists "terms" text;
alter table "chess_sponsor_agreements" add column if not exists "status" text;
alter table "chess_sponsor_agreements" add column if not exists "createdBy" text;
alter table "chess_sponsor_agreements" add column if not exists "approvedBy" text;
alter table "chess_sponsor_agreements" add column if not exists "approvedAt" timestamptz;
alter table "chess_sponsor_agreements" add column if not exists "createdAt" timestamptz;
alter table "chess_sponsor_contributions" add column if not exists "partnerId" text;
alter table "chess_sponsor_contributions" add column if not exists "agreementId" text;
alter table "chess_sponsor_contributions" add column if not exists "amount" numeric;
alter table "chess_sponsor_contributions" add column if not exists "currency" text;
alter table "chess_sponsor_contributions" add column if not exists "receivedAt" timestamptz;
alter table "chess_sponsor_contributions" add column if not exists "financeReference" text;
alter table "chess_sponsor_contributions" add column if not exists "authoritativeSource" text;
alter table "chess_sponsor_contributions" add column if not exists "recordedBy" text;
alter table "chess_sponsor_contributions" add column if not exists "createdAt" timestamptz;
alter table "chess_sponsor_deliverables" add column if not exists "agreementId" text;
alter table "chess_sponsor_deliverables" add column if not exists "partnerId" text;
alter table "chess_sponsor_deliverables" add column if not exists "title" text;
alter table "chess_sponsor_deliverables" add column if not exists "ownerId" text;
alter table "chess_sponsor_deliverables" add column if not exists "dueAt" timestamptz;
alter table "chess_sponsor_deliverables" add column if not exists "status" text;
alter table "chess_sponsor_deliverables" add column if not exists "completedAt" timestamptz;
alter table "chess_sponsor_deliverables" add column if not exists "createdBy" text;
alter table "chess_sponsor_deliverables" add column if not exists "createdAt" timestamptz;
alter table "chess_sponsor_deliverables" add column if not exists "completedBy" text;
alter table "chess_sponsor_partners" add column if not exists "name" text;
alter table "chess_sponsor_partners" add column if not exists "type" text;
alter table "chess_sponsor_partners" add column if not exists "stage" text;
alter table "chess_sponsor_partners" add column if not exists "stageHistory" jsonb;
alter table "chess_sponsor_partners" add column if not exists "contactName" text;
alter table "chess_sponsor_partners" add column if not exists "contactEmail" text;
alter table "chess_sponsor_partners" add column if not exists "website" text;
alter table "chess_sponsor_partners" add column if not exists "logoUrl" text;
alter table "chess_sponsor_partners" add column if not exists "confidentialTerms" text;
alter table "chess_sponsor_partners" add column if not exists "recognitionStatus" text;
alter table "chess_sponsor_partners" add column if not exists "recognitionApproved" boolean;
alter table "chess_sponsor_partners" add column if not exists "recognitionPublished" boolean;
alter table "chess_sponsor_partners" add column if not exists "recognitionApprovedBy" text;
alter table "chess_sponsor_partners" add column if not exists "createdBy" text;
alter table "chess_sponsor_partners" add column if not exists "createdAt" timestamptz;
alter table "chess_sponsor_partners" add column if not exists "recognitionRequestedBy" text;
alter table "chess_sponsor_partners" add column if not exists "recognitionRequestedAt" timestamptz;
alter table "chess_sponsor_partners" add column if not exists "logoUseApproved" boolean;
alter table "chess_sponsor_partners" add column if not exists "recognitionApprovedAt" timestamptz;
alter table "chess_strategy_key_results" add column if not exists "objectiveId" text;
alter table "chess_strategy_key_results" add column if not exists "title" text;
alter table "chess_strategy_key_results" add column if not exists "target" numeric;
alter table "chess_strategy_key_results" add column if not exists "current" numeric;
alter table "chess_strategy_key_results" add column if not exists "unit" text;
alter table "chess_strategy_key_results" add column if not exists "createdBy" text;
alter table "chess_strategy_key_results" add column if not exists "createdAt" timestamptz;
alter table "chess_strategy_milestones" add column if not exists "objectiveId" text;
alter table "chess_strategy_milestones" add column if not exists "title" text;
alter table "chess_strategy_milestones" add column if not exists "dueDate" timestamptz;
alter table "chess_strategy_milestones" add column if not exists "ownerId" text;
alter table "chess_strategy_milestones" add column if not exists "status" text;
alter table "chess_strategy_milestones" add column if not exists "completedAt" timestamptz;
alter table "chess_strategy_milestones" add column if not exists "createdBy" text;
alter table "chess_strategy_milestones" add column if not exists "createdAt" timestamptz;
alter table "chess_strategy_objectives" add column if not exists "title" text;
alter table "chess_strategy_objectives" add column if not exists "definition" text;
alter table "chess_strategy_objectives" add column if not exists "ownerId" text;
alter table "chess_strategy_objectives" add column if not exists "reviewDate" timestamptz;
alter table "chess_strategy_objectives" add column if not exists "status" text;
alter table "chess_strategy_objectives" add column if not exists "version" numeric;
alter table "chess_strategy_objectives" add column if not exists "publicSummary" text;
alter table "chess_strategy_objectives" add column if not exists "publicSummaryStatus" text;
alter table "chess_strategy_objectives" add column if not exists "publicSummaryAuthor" text;
alter table "chess_strategy_objectives" add column if not exists "publicSummaryApprovedBy" text;
alter table "chess_strategy_objectives" add column if not exists "archivedAt" timestamptz;
alter table "chess_strategy_objectives" add column if not exists "createdBy" text;
alter table "chess_strategy_objectives" add column if not exists "createdAt" timestamptz;
alter table "chess_strategy_objectives" add column if not exists "publicSummaryApprovedAt" timestamptz;
alter table "chess_strategy_reviews" add column if not exists "objectiveId" text;
alter table "chess_strategy_reviews" add column if not exists "scheduledFor" text;
alter table "chess_strategy_reviews" add column if not exists "heldAt" timestamptz;
alter table "chess_strategy_reviews" add column if not exists "decisions" jsonb;
alter table "chess_strategy_reviews" add column if not exists "attendees" jsonb;
alter table "chess_strategy_reviews" add column if not exists "notes" text;
alter table "chess_strategy_reviews" add column if not exists "recordedBy" text;
alter table "chess_strategy_reviews" add column if not exists "createdAt" timestamptz;
alter table "chess_strategy_risks" add column if not exists "objectiveId" text;
alter table "chess_strategy_risks" add column if not exists "description" text;
alter table "chess_strategy_risks" add column if not exists "likelihood" numeric;
alter table "chess_strategy_risks" add column if not exists "impact" numeric;
alter table "chess_strategy_risks" add column if not exists "severity" text;
alter table "chess_strategy_risks" add column if not exists "mitigation" text;
alter table "chess_strategy_risks" add column if not exists "ownerId" text;
alter table "chess_strategy_risks" add column if not exists "status" text;
alter table "chess_strategy_risks" add column if not exists "createdBy" text;
alter table "chess_strategy_risks" add column if not exists "createdAt" timestamptz;
alter table "chess_support_ticket_notes" add column if not exists "ticketId" text;
alter table "chess_support_ticket_notes" add column if not exists "authorId" text;
alter table "chess_support_ticket_notes" add column if not exists "body" text;
alter table "chess_support_ticket_notes" add column if not exists "internal" boolean;
alter table "chess_support_ticket_notes" add column if not exists "createdAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "reference" text;
alter table "chess_support_tickets" add column if not exists "category" text;
alter table "chess_support_tickets" add column if not exists "subject" text;
alter table "chess_support_tickets" add column if not exists "body" text;
alter table "chess_support_tickets" add column if not exists "priority" text;
alter table "chess_support_tickets" add column if not exists "confidential" boolean;
alter table "chess_support_tickets" add column if not exists "queue" text;
alter table "chess_support_tickets" add column if not exists "status" text;
alter table "chess_support_tickets" add column if not exists "requesterId" text;
alter table "chess_support_tickets" add column if not exists "assigneeId" text;
alter table "chess_support_tickets" add column if not exists "relatedTo" text;
alter table "chess_support_tickets" add column if not exists "attachments" jsonb;
alter table "chess_support_tickets" add column if not exists "slaDueAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "escalated" boolean;
alter table "chess_support_tickets" add column if not exists "escalationReason" text;
alter table "chess_support_tickets" add column if not exists "escalatedAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "escalatedBy" text;
alter table "chess_support_tickets" add column if not exists "resolution" text;
alter table "chess_support_tickets" add column if not exists "resolvedAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "closedAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "acknowledgedAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "reopenCount" numeric;
alter table "chess_support_tickets" add column if not exists "openedAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "assignedBy" text;
alter table "chess_support_tickets" add column if not exists "assignedAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "resolvedBy" text;
alter table "chess_support_tickets" add column if not exists "closedBy" text;
alter table "chess_support_tickets" add column if not exists "reopenReason" text;
alter table "chess_support_tickets" add column if not exists "reopenedAt" timestamptz;
alter table "chess_support_tickets" add column if not exists "escalatedTo" text;
alter table "chess_survey_actions" add column if not exists "pollId" text;
alter table "chess_survey_actions" add column if not exists "title" text;
alter table "chess_survey_actions" add column if not exists "ownerId" text;
alter table "chess_survey_actions" add column if not exists "dueAt" timestamptz;
alter table "chess_survey_actions" add column if not exists "status" text;
alter table "chess_survey_actions" add column if not exists "outcome" text;
alter table "chess_survey_actions" add column if not exists "createdBy" text;
alter table "chess_survey_actions" add column if not exists "createdAt" timestamptz;
alter table "chess_survey_actions" add column if not exists "completedAt" timestamptz;
alter table "chess_survey_actions" add column if not exists "completedBy" text;
alter table "chess_survey_polls" add column if not exists "title" text;
alter table "chess_survey_polls" add column if not exists "type" text;
alter table "chess_survey_polls" add column if not exists "selection" text;
alter table "chess_survey_polls" add column if not exists "maxSelections" numeric;
alter table "chess_survey_polls" add column if not exists "options" jsonb;
alter table "chess_survey_polls" add column if not exists "questions" jsonb;
alter table "chess_survey_polls" add column if not exists "purpose" text;
alter table "chess_survey_polls" add column if not exists "audience" text;
alter table "chess_survey_polls" add column if not exists "closesAt" timestamptz;
alter table "chess_survey_polls" add column if not exists "resultVisibility" text;
alter table "chess_survey_polls" add column if not exists "anonymous" boolean;
alter table "chess_survey_polls" add column if not exists "status" text;
alter table "chess_survey_polls" add column if not exists "officialElection" boolean;
alter table "chess_survey_polls" add column if not exists "voterSalt" text;
alter table "chess_survey_polls" add column if not exists "createdBy" text;
alter table "chess_survey_polls" add column if not exists "publishedAt" timestamptz;
alter table "chess_survey_polls" add column if not exists "closedAt" timestamptz;
alter table "chess_survey_polls" add column if not exists "createdAt" timestamptz;
alter table "chess_survey_responses" add column if not exists "pollId" text;
alter table "chess_survey_responses" add column if not exists "userId" text;
alter table "chess_survey_responses" add column if not exists "anonymous" boolean;
alter table "chess_survey_responses" add column if not exists "optionIds" jsonb;
alter table "chess_survey_responses" add column if not exists "comment" text;
alter table "chess_survey_responses" add column if not exists "createdAt" timestamptz;
alter table "chess_survey_vote_ledger" add column if not exists "pollId" text;
alter table "chess_survey_vote_ledger" add column if not exists "voterToken" text;
alter table "chess_survey_vote_ledger" add column if not exists "anonymous" boolean;
alter table "chess_survey_vote_ledger" add column if not exists "createdAt" timestamptz;
alter table "chess_system_setting_history" add column if not exists "key" text;
alter table "chess_system_setting_history" add column if not exists "value" text;
alter table "chess_system_setting_history" add column if not exists "version" numeric;
alter table "chess_system_setting_history" add column if not exists "action" text;
alter table "chess_system_setting_history" add column if not exists "actorId" text;
alter table "chess_system_setting_history" add column if not exists "createdAt" timestamptz;
alter table "chess_system_settings" add column if not exists "key" text;
alter table "chess_system_settings" add column if not exists "value" text;
alter table "chess_system_settings" add column if not exists "version" numeric;
alter table "chess_system_settings" add column if not exists "status" text;
alter table "chess_system_settings" add column if not exists "updatedBy" text;
alter table "chess_system_settings" add column if not exists "createdAt" timestamptz;
alter table "chess_system_settings" add column if not exists "rolledBackFrom" text;
alter table "chess_system_settings" add column if not exists "pendingValue" boolean;
alter table "chess_system_settings" add column if not exists "pendingRequestedBy" text;
alter table "chess_system_settings" add column if not exists "pendingRequestedAt" timestamptz;
alter table "chess_system_settings" add column if not exists "pendingVersion" numeric;
alter table "chess_system_settings" add column if not exists "pendingReason" text;
alter table "chess_system_settings" add column if not exists "approvedBy" text;
alter table "chess_system_settings" add column if not exists "approvedAt" timestamptz;
alter table "chess_tournament_registrations" add column if not exists "tournamentId" text;
alter table "chess_tournament_registrations" add column if not exists "playerId" text;
alter table "chess_tournament_registrations" add column if not exists "status" text;
alter table "chess_tournament_registrations" add column if not exists "createdAt" timestamptz;
alter table "chess_tournament_registrations" add column if not exists "waitlistPosition" numeric;
alter table "chess_tournament_registrations" add column if not exists "addedManually" boolean;
alter table "chess_tournament_registrations" add column if not exists "registeredBy" text;
alter table "chess_tournament_registrations" add column if not exists "registeredAt" timestamptz;
alter table "chess_tournament_registrations" add column if not exists "withdrawnAt" timestamptz;
alter table "chess_tournaments" add column if not exists "name" text;
alter table "chess_tournaments" add column if not exists "status" text;
alter table "chess_tournaments" add column if not exists "capacity" numeric;
alter table "chess_tournaments" add column if not exists "createdAt" timestamptz;
alter table "chess_tournaments" add column if not exists "description" text;
alter table "chess_tournaments" add column if not exists "format" text;
alter table "chess_tournaments" add column if not exists "rounds" numeric;
alter table "chess_tournaments" add column if not exists "startsAt" timestamptz;
alter table "chess_tournaments" add column if not exists "registrationOpensAt" timestamptz;
alter table "chess_tournaments" add column if not exists "registrationClosesAt" timestamptz;
alter table "chess_tournaments" add column if not exists "venue" text;
alter table "chess_tournaments" add column if not exists "scheduleStatus" text;
alter table "chess_tournaments" add column if not exists "scheduleProposedBy" text;
alter table "chess_tournaments" add column if not exists "scheduleApprovedBy" text;
alter table "chess_tournaments" add column if not exists "createdBy" text;
alter table "chess_tournaments" add column if not exists "schedule" jsonb;
alter table "chess_tournaments" add column if not exists "scheduleProposedAt" timestamptz;
alter table "chess_tournaments" add column if not exists "scheduleApprovedAs" text;
alter table "chess_tournaments" add column if not exists "scheduleApprovedAt" timestamptz;
alter table "chess_travel_notices" add column if not exists "tripId" text;
alter table "chess_travel_notices" add column if not exists "userId" text;
alter table "chess_travel_notices" add column if not exists "kind" text;
alter table "chess_travel_notices" add column if not exists "message" text;
alter table "chess_travel_notices" add column if not exists "createdBy" text;
alter table "chess_travel_notices" add column if not exists "createdAt" timestamptz;
alter table "chess_travel_passengers" add column if not exists "tripId" text;
alter table "chess_travel_passengers" add column if not exists "userId" text;
alter table "chess_travel_passengers" add column if not exists "status" text;
alter table "chess_travel_passengers" add column if not exists "seatNo" numeric;
alter table "chess_travel_passengers" add column if not exists "emergencyContact" text;
alter table "chess_travel_passengers" add column if not exists "personalNotes" text;
alter table "chess_travel_passengers" add column if not exists "addedBy" text;
alter table "chess_travel_passengers" add column if not exists "confirmedAt" timestamptz;
alter table "chess_travel_passengers" add column if not exists "createdAt" timestamptz;
alter table "chess_travel_passengers" add column if not exists "confirmedBy" text;
alter table "chess_travel_passengers" add column if not exists "withdrawnAt" timestamptz;
alter table "chess_travel_passengers" add column if not exists "withdrawalReason" text;
alter table "chess_travel_trips" add column if not exists "title" text;
alter table "chess_travel_trips" add column if not exists "destination" text;
alter table "chess_travel_trips" add column if not exists "purpose" text;
alter table "chess_travel_trips" add column if not exists "startsAt" timestamptz;
alter table "chess_travel_trips" add column if not exists "endsAt" timestamptz;
alter table "chess_travel_trips" add column if not exists "seatCapacity" numeric;
alter table "chess_travel_trips" add column if not exists "transportOptions" jsonb;
alter table "chess_travel_trips" add column if not exists "accommodationNote" text;
alter table "chess_travel_trips" add column if not exists "itinerary" jsonb;
alter table "chess_travel_trips" add column if not exists "status" text;
alter table "chess_travel_trips" add column if not exists "requestedBy" text;
alter table "chess_travel_trips" add column if not exists "approvedBy" text;
alter table "chess_travel_trips" add column if not exists "approvedAt" timestamptz;
alter table "chess_travel_trips" add column if not exists "rejectionReason" text;
alter table "chess_travel_trips" add column if not exists "completedAt" timestamptz;
alter table "chess_travel_trips" add column if not exists "paymentProcessed" boolean;
alter table "chess_travel_trips" add column if not exists "externalBookingRequired" boolean;
alter table "chess_travel_trips" add column if not exists "createdAt" timestamptz;
alter table "chess_travel_trips" add column if not exists "submittedAt" timestamptz;
alter table "chess_travel_trips" add column if not exists "submittedBy" text;
alter table "chess_travel_trips" add column if not exists "rejectedBy" text;
alter table "chess_users" add column if not exists "email" text;
alter table "chess_users" add column if not exists "name" text;
alter table "chess_users" add column if not exists "roles" jsonb;
alter table "chess_users" add column if not exists "state" text;
alter table "chess_users" add column if not exists "permissions" jsonb;
alter table "chess_users" add column if not exists "passwordHash" text;
alter table "chess_users" add column if not exists "createdAt" timestamptz;
alter table "chess_users" add column if not exists "importedBatchId" text;
alter table "chess_users" add column if not exists "rolesAssignedBy" text;
alter table "chess_users" add column if not exists "rolesAssignedAt" timestamptz;
alter table "chess_users" add column if not exists "passwordChangedAt" timestamptz;
alter table "chess_volunteer_assignments" add column if not exists "shiftId" text;
alter table "chess_volunteer_assignments" add column if not exists "opportunityId" text;
alter table "chess_volunteer_assignments" add column if not exists "volunteerId" text;
alter table "chess_volunteer_assignments" add column if not exists "status" text;
alter table "chess_volunteer_assignments" add column if not exists "checkedInAt" timestamptz;
alter table "chess_volunteer_assignments" add column if not exists "checkedInBy" text;
alter table "chess_volunteer_assignments" add column if not exists "feedback" text;
alter table "chess_volunteer_assignments" add column if not exists "rating" numeric;
alter table "chess_volunteer_assignments" add column if not exists "signedUpAt" timestamptz;
alter table "chess_volunteer_assignments" add column if not exists "createdAt" timestamptz;
alter table "chess_volunteer_assignments" add column if not exists "withdrawnAt" timestamptz;
alter table "chess_volunteer_assignments" add column if not exists "respondedAt" timestamptz;
alter table "chess_volunteer_assignments" add column if not exists "completedBy" text;
alter table "chess_volunteer_assignments" add column if not exists "completedAt" timestamptz;
alter table "chess_volunteer_opportunities" add column if not exists "title" text;
alter table "chess_volunteer_opportunities" add column if not exists "description" text;
alter table "chess_volunteer_opportunities" add column if not exists "requirements" jsonb;
alter table "chess_volunteer_opportunities" add column if not exists "capacity" numeric;
alter table "chess_volunteer_opportunities" add column if not exists "activityId" text;
alter table "chess_volunteer_opportunities" add column if not exists "status" text;
alter table "chess_volunteer_opportunities" add column if not exists "createdBy" text;
alter table "chess_volunteer_opportunities" add column if not exists "createdAt" timestamptz;
alter table "chess_volunteer_shifts" add column if not exists "opportunityId" text;
alter table "chess_volunteer_shifts" add column if not exists "role" text;
alter table "chess_volunteer_shifts" add column if not exists "startsAt" timestamptz;
alter table "chess_volunteer_shifts" add column if not exists "endsAt" timestamptz;
alter table "chess_volunteer_shifts" add column if not exists "capacity" numeric;
alter table "chess_volunteer_shifts" add column if not exists "status" text;
alter table "chess_volunteer_shifts" add column if not exists "createdBy" text;
alter table "chess_volunteer_shifts" add column if not exists "createdAt" timestamptz;
