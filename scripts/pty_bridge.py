#!/usr/bin/env python3
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def parse_size():
    def read_int(name, fallback):
        value = os.environ.get(name)
        if value is None:
            return fallback
        try:
            return max(1, int(value))
        except ValueError:
            return fallback

    return read_int("THREADVM_COLS", 120), read_int("THREADVM_ROWS", 32)


def set_winsize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def set_nonblocking(fd):
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def write_all(fd, data):
    while data:
        try:
            written = os.write(fd, data)
            data = data[written:]
        except BlockingIOError:
            select.select([], [fd], [])
        except OSError as error:
            if error.errno in (errno.EIO, errno.EPIPE):
                return
            raise


def spawn_child(argv, cols, rows):
    master_fd, slave_fd = pty.openpty()
    set_winsize(slave_fd, cols, rows)

    pid = os.fork()
    if pid == 0:
        try:
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)
            os.execvp(argv[0], argv)
        except BaseException as error:
            message = f"pty bridge exec failed: {error}\n".encode()
            os.write(2, message)
            os._exit(127)

    os.close(slave_fd)
    return pid, master_fd


def child_done(pid):
    try:
        result = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        return True, 0

    if result == (0, 0):
        return False, 0

    _, status = result
    if os.WIFEXITED(status):
        return True, os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return True, 128 + os.WTERMSIG(status)
    return True, 1


def main():
    if "--" not in sys.argv:
        print("usage: pty_bridge.py -- command [args...]", file=sys.stderr)
        return 2

    command_index = sys.argv.index("--") + 1
    argv = sys.argv[command_index:]
    if not argv:
        print("pty_bridge.py: missing command", file=sys.stderr)
        return 2

    cols, rows = parse_size()
    child_pid, master_fd = spawn_child(argv, cols, rows)

    set_nonblocking(0)
    set_nonblocking(master_fd)

    control_fd = 3
    try:
        os.fstat(control_fd)
        set_nonblocking(control_fd)
    except OSError:
        control_fd = None

    def stop_child(_signum, _frame):
        try:
            os.killpg(child_pid, signal.SIGTERM)
        except OSError:
            pass

    signal.signal(signal.SIGTERM, stop_child)
    signal.signal(signal.SIGINT, stop_child)

    input_open = True
    control_open = control_fd is not None
    control_buffer = b""

    while True:
        done, code = child_done(child_pid)
        if done:
            return code

        read_fds = [master_fd]
        if input_open:
            read_fds.append(0)
        if control_open and control_fd is not None:
            read_fds.append(control_fd)

        try:
            readable, _, _ = select.select(read_fds, [], [], 0.1)
        except OSError as error:
            if error.errno == errno.EINTR:
                continue
            raise

        for fd in readable:
            if fd == master_fd:
                try:
                    data = os.read(master_fd, 65536)
                except BlockingIOError:
                    continue
                except OSError as error:
                    if error.errno == errno.EIO:
                        done, code = child_done(child_pid)
                        return code if done else 0
                    raise
                if not data:
                    done, code = child_done(child_pid)
                    return code if done else 0
                write_all(1, data)
            elif fd == 0:
                try:
                    data = os.read(0, 65536)
                except BlockingIOError:
                    continue
                if not data:
                    input_open = False
                    continue
                write_all(master_fd, data)
            elif control_fd is not None and fd == control_fd:
                try:
                    data = os.read(control_fd, 4096)
                except BlockingIOError:
                    continue
                if not data:
                    control_open = False
                    continue
                control_buffer += data
                while b"\n" in control_buffer:
                    line, control_buffer = control_buffer.split(b"\n", 1)
                    if not line:
                        continue
                    try:
                        message = json.loads(line.decode("utf8"))
                        if message.get("type") == "resize":
                            next_cols = max(1, int(message["cols"]))
                            next_rows = max(1, int(message["rows"]))
                            set_winsize(master_fd, next_cols, next_rows)
                            try:
                                os.killpg(child_pid, signal.SIGWINCH)
                            except OSError:
                                pass
                    except Exception as error:
                        print(f"pty bridge control error: {error}", file=sys.stderr)

        time.sleep(0)


if __name__ == "__main__":
    sys.exit(main())
