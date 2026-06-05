/**
 * HEIC → JPEG Conversion — TEMPORARILY DISABLED (p1_260).
 *
 * heic-convert npm package fail install pada Netlify (native libheif build).
 * Function disabled untuk unblock Netlify deploy.
 *
 * Plan B: client-side HEIC conversion via heic2any CDN — pending implementation.
 * Until then, return clear "disabled" message.
 */

exports.handler = async (event) => {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    if(event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

    return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
            disabled: true,
            reason: 'HEIC conversion temporarily disabled — heic-convert npm package fail install pada Netlify. Client-side conversion via heic2any pending. Existing entries (e.g. sale #4981) telah convert manual sebelum disable.'
        })
    };
};
