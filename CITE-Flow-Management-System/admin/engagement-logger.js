/*
  engagement-logger.js
  Add this file to every CITE-Flow page after Supabase is initialized.
  Required before this file:
  window.supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);
*/

(function () {
    const DEFAULT_TYPES = {
        download: 'Download',
        feedback: 'Feedback Summary',
        profile: 'Profile Update',
        document: 'Document Action',
        system: 'System Event'
    };

    function getClient() {
        if (window.supabaseClient) return window.supabaseClient;
        console.warn('EngagementLogger: Supabase client is not available.');
        return null;
    }

    function pageName() {
        const file = (window.location.pathname.split('/').pop() || 'Page').replace('.html', '');
        return file
            .split('-')
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    async function getCurrentActor(client) {
        try {
            const { data } = await client.auth.getUser();
            const user = data?.user;

            if (!user) return { id: null, name: 'System' };

            const meta = user.user_metadata || {};
            const name =
                [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim() ||
                user.email ||
                'System';

            return { id: user.id, name };
        } catch (error) {
            return { id: null, name: 'System' };
        }
    }

    function asDetails(details) {
        if (!details) return [];

        if (Array.isArray(details)) return details;

        if (typeof details === 'object') {
            return Object.entries(details).map(([label, value]) => ({
                label,
                value
            }));
        }

        return [{ label: 'Details', value: String(details) }];
    }

    async function logActivity(payload) {
        const client = getClient();

        if (!client) {
            return { error: 'Supabase client is not available.' };
        }

        const actor = await getCurrentActor(client);

        const record = {
            faculty_id: payload.facultyId || payload.faculty_id || null,
            faculty_name:
                payload.facultyName ||
                payload.faculty_name ||
                payload.faculty ||
                actor.name ||
                'Unknown Faculty',
            department: payload.department || null,
            activity_type:
                payload.activityType ||
                payload.activity_type ||
                DEFAULT_TYPES.system,
            activity_title:
                payload.activityTitle ||
                payload.activity_title ||
                'Recorded activity',
            description:
                payload.description ||
                'Activity recorded from ' + pageName() + '.',
            source_module:
                payload.sourceModule ||
                payload.source_module ||
                pageName(),
            activity_at:
                payload.activityAt ||
                payload.activity_at ||
                new Date().toISOString(),
            status: payload.status || 'Completed',
            details: asDetails(payload.details),
            created_by: payload.createdBy || payload.created_by || actor.id,
            created_by_name:
                payload.createdByName ||
                payload.created_by_name ||
                actor.name
        };

        const { data, error } = await client
            .from('engagement_logs')
            .insert(record)
            .select()
            .single();

        if (error) {
            console.error('EngagementLogger: failed to create log entry.', error);
            return { error };
        }

        return { data };
    }

    function logDownload({
        facultyName,
        department,
        fileName,
        sourceModule = 'Document Vault',
        description,
        details
    }) {
        return logActivity({
            facultyName,
            department,
            activityType: DEFAULT_TYPES.download,
            activityTitle: fileName ? 'Downloaded ' + fileName : 'Downloaded a document',
            description:
                description ||
                (fileName
                    ? 'Downloaded ' + fileName + ' from ' + sourceModule + '.'
                    : 'Downloaded a document from ' + sourceModule + '.'),
            sourceModule,
            details: details || {
                File: fileName || 'Not specified'
            }
        });
    }

    function logFeedbackSummary({
        facultyName,
        department,
        eventName,
        averageRating,
        sourceModule = 'Seminar Feedback Summary',
        description,
        details
    }) {
        return logActivity({
            facultyName,
            department,
            activityType: DEFAULT_TYPES.feedback,
            activityTitle: 'Submitted feedback summary',
            description:
                description ||
                'Submitted consolidated feedback summary' +
                    (eventName ? ' for ' + eventName : '') +
                    '.',
            sourceModule,
            status: 'For Review',
            details:
                details || {
                    Event: eventName || 'Not specified',
                    'Average Rating': averageRating || 'Not specified'
                }
        });
    }

    function logProfileUpdate({
        facultyName,
        department,
        fieldsUpdated,
        sourceModule = 'Faculty Profiles',
        description,
        details
    }) {
        const fields = Array.isArray(fieldsUpdated)
            ? fieldsUpdated.join(', ')
            : fieldsUpdated;

        return logActivity({
            facultyName,
            department,
            activityType: DEFAULT_TYPES.profile,
            activityTitle: 'Updated faculty profile information',
            description:
                description ||
                'Updated faculty profile information' +
                    (fields ? ': ' + fields : '') +
                    '.',
            sourceModule,
            details:
                details || {
                    'Fields Updated': fields || 'Not specified'
                }
        });
    }

    function readDatasetLog(element) {
        return {
            facultyName: element.dataset.facultyName,
            department: element.dataset.department,
            activityType: element.dataset.activityType,
            activityTitle: element.dataset.activityTitle,
            description: element.dataset.description,
            sourceModule: element.dataset.sourceModule,
            status: element.dataset.status,
            details: element.dataset.details
                ? { Details: element.dataset.details }
                : undefined
        };
    }

    document.addEventListener('click', function (event) {
        const target = event.target.closest('[data-engagement-log]');
        if (!target) return;

        const payload = readDatasetLog(target);

        if (!payload.activityTitle && !payload.description) return;

        logActivity(payload);
    });

    window.EngagementLogger = {
        logActivity,
        logDownload,
        logFeedbackSummary,
        logProfileUpdate
    };
})();