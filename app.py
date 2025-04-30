from flask import Flask, request, send_file, jsonify, render_template
import yt_dlp
import os
import re
import time
import threading
import uuid
from datetime import datetime
from werkzeug.utils import secure_filename
import mimetypes

app = Flask(__name__)

# Configuration
DOWNLOAD_DIR = 'downloads'
STATIC_DIR = 'static'
MAX_FILE_AGE = 7200  # 2 hours in seconds
ALLOWED_EXTENSIONS = {'mp4', 'webm', 'mkv', 'avi', 'mov'}

# Create necessary directories
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, 'images'), exist_ok=True)

# Shared state for tracking downloads
download_progress = {}
download_files = {}
download_lock = threading.Lock()

def cleanup_old_downloads():
    """Remove files older than MAX_FILE_AGE."""
    now = time.time()
    try:
        for filename in os.listdir(DOWNLOAD_DIR):
            filepath = os.path.join(DOWNLOAD_DIR, filename)
            if os.path.isfile(filepath):
                try:
                    file_age = now - os.path.getmtime(filepath)
                    if file_age > MAX_FILE_AGE:
                        os.remove(filepath)
                        # Clean up any associated state
                        with download_lock:
                            for d_id, f_path in list(download_files.items()):
                                if f_path == filepath:
                                    download_files.pop(d_id, None)
                                    download_progress.pop(d_id, None)
                except Exception as e:
                    app.logger.error(f"Error deleting file {filepath}: {e}")
    except Exception as e:
        app.logger.error(f"Error during cleanup: {e}")

def sanitize_filename(filename):
    """Sanitize filename and ensure it has an allowed extension."""
    filename = re.sub(r'[\\/*?:"<>|]', "-", filename)
    filename = secure_filename(filename)
    base, ext = os.path.splitext(filename)
    ext = ext[1:].lower() if ext else 'mp4'
    
    if ext not in ALLOWED_EXTENSIONS:
        ext = 'mp4'

    if len(base) > 100:
        base = base[:100]

    return f"{base}.{ext}"

def get_quality_label(height):
    """Convert height to quality label."""
    if height >= 2160: return "4K"
    elif height >= 1440: return "2K"
    elif height >= 1080: return "1080p"
    elif height >= 720: return "720p"
    elif height >= 480: return "480p"
    elif height >= 360: return "360p"
    elif height >= 240: return "240p"
    else: return f"{height}p"

@app.route('/')
def home():
    cleanup_old_downloads()
    return render_template('index.html')

@app.route('/fetch-info', methods=['POST'])
def fetch_info():
    data = request.get_json()
    url = data.get('url')

    if not url:
        return jsonify({'error': 'No URL provided'}), 400

    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'simulate': True,
            'nocheckcertificate': True,
            'geo_bypass': True
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            # Handle thumbnail URL
            thumbnail = info.get('thumbnail', '')
            if not thumbnail or not thumbnail.startswith(('http://', 'https://')):
                thumbnail = '/static/images/placeholder.jpg'

            processed_formats = []
            seen_resolutions = set()

            for fmt in info.get('formats', []):
                if fmt.get('vcodec') == 'none':
                    continue

                height = fmt.get('height')
                width = fmt.get('width')
                if not height or not width:
                    continue

                resolution = (width, height)
                filesize = fmt.get('filesize') or fmt.get('filesize_approx')
                if not filesize:
                    continue

                if resolution in seen_resolutions:
                    continue

                seen_resolutions.add(resolution)

                processed_formats.append({
                    'format_id': fmt['format_id'],
                    'quality_label': get_quality_label(height),
                    'height': height,
                    'width': width,
                    'ext': fmt.get('ext', 'mp4'),
                    'filesize': filesize
                })

            processed_formats.sort(key=lambda x: x['height'], reverse=True)

            return jsonify({
                'title': info.get('title', 'Unknown Title'),
                'thumbnail': thumbnail,
                'duration': info.get('duration', 0),
                'uploader': info.get('uploader', 'Unknown'),
                'formats': processed_formats,
            })

    except yt_dlp.utils.DownloadError as e:
        error_message = str(e).split('ERROR: ')[-1] if 'ERROR: ' in str(e) else 'Video unavailable or private.'
        if "Private video" in error_message or "Sign in" in error_message:
            error_message = "Video is private, age-restricted, or requires login."
        return jsonify({'error': error_message}), 400
    except Exception as e:
        return jsonify({'error': 'Failed to fetch video information.'}), 500

@app.route('/download', methods=['POST'])
def download():
    data = request.get_json()
    url = data.get('url')
    format_id = data.get('format_id')
    filename_base = data.get('filename', 'video')

    if not url or not format_id:
        return jsonify({'error': 'Missing URL or format ID'}), 400

    download_id = str(uuid.uuid4())

    with download_lock:
        download_progress[download_id] = 0.0
        download_files[download_id] = None

    thread = threading.Thread(
        target=download_video,
        args=(url, format_id, filename_base, download_id),
        daemon=True
    )
    thread.start()

    return jsonify({
        'download_id': download_id,
        'message': 'Download started'
    })

def download_video(url, format_id, filename_base, download_id):
    try:
        sanitized_name = sanitize_filename(filename_base)
        output_path = os.path.join(DOWNLOAD_DIR, f"{download_id}_{sanitized_name}")

        def progress_hook(d):
            with download_lock:
                if download_id not in download_progress:
                    return

                if d['status'] == 'downloading':
                    if d.get('total_bytes'):
                        percent = (d['downloaded_bytes'] / d['total_bytes']) * 100
                    elif d.get('total_bytes_estimate'):
                        percent = (d['downloaded_bytes'] / d['total_bytes_estimate']) * 100
                    else:
                        percent = download_progress.get(download_id, 0.0)
                        if percent == 0.0:
                            percent = 1.0

                    download_progress[download_id] = min(percent, 99.9)

                elif d['status'] == 'finished':
                    final_filepath = d['filename']
                    download_progress[download_id] = 100.0
                    download_files[download_id] = final_filepath
                    app.logger.info(f"Download finished: {final_filepath}")

                elif d['status'] == 'error':
                    download_progress[download_id] = -1
                    if d.get('filename') and os.path.exists(d['filename']):
                        try:
                            os.remove(d['filename'])
                        except Exception as rm_e:
                            app.logger.error(f"Error removing partial file: {rm_e}")

        ydl_opts = {
            'format': format_id,
            'outtmpl': output_path + '.%(ext)s',
            'progress_hooks': [progress_hook],
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'restrictfilenames': True,
            'nocheckcertificate': True,
            'geo_bypass': True,
            'format_sort': ['res:1080', 'res:720', 'res:480', 'res:360'],
            'merge_output_format': None
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

    except Exception as e:
        app.logger.error(f"Download processing failed: {e}")
        with download_lock:
            download_progress[download_id] = -1
            download_files[download_id] = None

@app.route('/progress/<download_id>')
def progress(download_id):
    with download_lock:
        progress = download_progress.get(download_id, -2)

    if progress == -2:
        return jsonify({'error': 'Download ID not found', 'progress': -2}), 404
    elif progress == -1:
        return jsonify({'error': 'Download failed', 'progress': -1}), 400

    return jsonify({'progress': progress})

@app.route('/get-file/<download_id>')
def get_file(download_id):
    with download_lock:
        filepath = download_files.get(download_id)
        download_files.pop(download_id, None)
        download_progress.pop(download_id, None)

    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'File not found or expired'}), 404

    try:
        mime_type, _ = mimetypes.guess_type(filepath)
        if not mime_type:
            mime_type = 'application/octet-stream'

        download_name = os.path.basename(filepath).split('_', 1)[1]  # Remove download ID prefix
        download_name = secure_filename(download_name)

        response = send_file(
            filepath,
            as_attachment=True,
            download_name=download_name,
            mimetype=mime_type
        )

        threading.Thread(
            target=cleanup_file_after_delay,
            args=(filepath,),
            daemon=True
        ).start()

        return response
    except Exception as e:
        return jsonify({'error': 'File download failed'}), 500

def cleanup_file_after_delay(filepath, delay=60):
    """Clean up the file after a delay to ensure download completes"""
    time.sleep(delay)
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
    except Exception as e:
        app.logger.error(f"Error cleaning up file {filepath}: {e}")

if __name__ == '__main__':
    def periodic_cleanup():
        while True:
            try:
                cleanup_old_downloads()
            except Exception as e:
                app.logger.error(f"Error in periodic cleanup: {e}")
            time.sleep(3600)

    cleanup_thread = threading.Thread(target=periodic_cleanup, daemon=True)
    cleanup_thread.start()

    app.run(debug=True, threaded=True, use_reloader=False)
