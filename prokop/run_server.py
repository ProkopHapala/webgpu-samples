import http.server
import socketserver
import os
import sys
import argparse

# --- Configuration ---
DEFAULT_PORT = 8000
# DEFAULT_DIRECTORY is now context-dependent; if no directory is given, it's the current dir.

# --- Request Handler Class ---
class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # The 'directory' argument is now passed when the server is created
        super().__init__(*args, **kwargs)

    def end_headers(self):
        # These headers are often required for WebGPU, especially for features like SharedArrayBuffer
        # or high-resolution timers, and are good practice for WebGPU development.
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

# --- Main Script Logic ---
def main():
    parser = argparse.ArgumentParser(
        description="A simple HTTP server for WebGPU development.",
        formatter_class=argparse.RawTextHelpFormatter # Preserve newlines in help
    )
    parser.add_argument(
        'directory', # This is now a positional argument
        nargs='?',   # '?' means 0 or 1 argument
        default='.', # Default to current directory if not provided
        help=f"Directory to serve files from (default: current directory '.')"
    )
    parser.add_argument(
        '--port',
        type=int,
        default=DEFAULT_PORT,
        help=f"Port number to serve on (default: {DEFAULT_PORT})"
    )

    args = parser.parse_args()
    port = args.port
    directory = args.directory

    # Resolve the absolute path of the directory
    absolute_directory = os.path.abspath(directory)

    # Check if the directory exists
    if not os.path.isdir(absolute_directory):
        print(f"ERROR: Directory '{absolute_directory}' does not exist.", file=sys.stderr)
        sys.exit(1)

    # Configure the handler to serve from the specified directory
    Handler = lambda *args, **kwargs: CustomHTTPRequestHandler(
        *args, directory=absolute_directory, **kwargs
    )

    try:
        with socketserver.TCPServer(("", port), Handler) as httpd:
            print(f"Serving files from: {absolute_directory}")
            print(f"Web server available at: http://localhost:{port}")
            print("Ensure your browser supports WebGPU (e.g., Chrome, Edge, Firefox Nightly with flags).")
            print("Press CTRL-C to stop the server.")
            httpd.serve_forever()
    except OSError as e:
        if e.errno == 98: # Errno 98 is "Address already in use"
            print(f"\nERROR: Port {port} is already in use by another process.", file=sys.stderr)
            print("To find which process is using the port, run:", file=sys.stderr)
            print(f"  sudo ss -tulnp | grep :{port}", file=sys.stderr)
            print("  (Look for the PID in the output, e.g., 'pid=12345')", file=sys.stderr)
            print("\nTo attempt to kill the process gracefully (replace 12345 with the actual PID):", file=sys.stderr)
            print(f"  kill 12345", file=sys.stderr)
            print("\nAlternatively, a more direct (but requires `lsof`) command to kill the process:", file=sys.stderr)
            print(f"  sudo kill $(sudo lsof -t -i:{port})", file=sys.stderr)
            print("\nAfter stopping the other process, try running this server script again.", file=sys.stderr)
        else:
            print(f"An unexpected OS error occurred: {e}", file=sys.stderr)
        sys.exit(1) # Exit with an error code
    except KeyboardInterrupt:
        print("\nServer stopped by user (Ctrl+C).")
        # httpd.shutdown() is called automatically by with statement context manager
        sys.exit(0) # Exit cleanly

if __name__ == "__main__":
    main()