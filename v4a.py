import sys, os


def strip(x):
    return x.strip()


def parse_error(line):
    sys.stderr.write("error: parse %s\n" % line)
    sys.exit(1)


def main():
    data = sys.stdin.read()
    lines = data.split("\n")
    # strip trailing empty lines to find last non-blank
    idxs = [i for i, l in enumerate(lines) if l.strip()]
    if not idxs:
        parse_error("1")
    first = idxs[0]
    last = idxs[-1]
    if lines[first].strip() != "*** Begin Patch":
        parse_error(lines[first].strip() or "1")
    if lines[last].strip() != "*** End Patch":
        parse_error(str(last + 1))

    body = lines[first + 1:last]
    # parse sections
    sections = []
    i = 0
    n = len(body)
    cur = None
    while i < n:
        line = body[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith("*** Add File: "):
            cur = {"type": "add", "path": s[len("*** Add File: "):].strip(), "lines": []}
            sections.append(cur)
            i += 1
        elif s == "*** Delete File: " or s.startswith("*** Delete File: "):
            cur = {"type": "delete", "path": s[len("*** Delete File: "):].strip()}
            sections.append(cur)
            i += 1
        elif s.startswith("*** Update File: "):
            cur = {"type": "update", "path": s[len("*** Update File: "):].strip(),
                   "move": None, "chunks": []}
            sections.append(cur)
            i += 1
        else:
            # body of current section
            if cur is None:
                parse_error(str(i + 1))
            if cur["type"] == "add":
                if line.startswith("+"):
                    cur["lines"].append(line[1:])
                elif line == "":
                    cur["lines"].append("")
                else:
                    parse_error(str(i + 1))
                i += 1
            elif cur["type"] == "delete":
                parse_error(str(i + 1))
            elif cur["type"] == "update":
                if line.startswith("*** Move to: "):
                    if len(cur["chunks"]) == 0 and cur["move"] is None:
                        cur["move"] = line[len("*** Move to: "):].strip()
                        i += 1
                    else:
                        parse_error(str(i + 1))
                elif line.startswith("@@"):
                    # start new chunk
                    anchor = line[2:].strip()
                    cur["chunks"].append({"anchor": anchor, "body": []})
                    i += 1
                elif line == "*** End of File":
                    cur["chunks"].append({"anchor": None, "eof": True, "body": []})
                    i += 1
                elif line.startswith(" "):
                    if not cur["chunks"]:
                        cur["chunks"].append({"anchor": None, "body": []})
                    cur["chunks"][-1]["body"].append(("ctx", line[1:]))
                    i += 1
                elif line.startswith("-"):
                    if not cur["chunks"]:
                        cur["chunks"].append({"anchor": None, "body": []})
                    cur["chunks"][-1]["body"].append(("del", line[1:]))
                    i += 1
                elif line.startswith("+"):
                    if not cur["chunks"]:
                        cur["chunks"].append({"anchor": None, "body": []})
                    cur["chunks"][-1]["body"].append(("add", line[1:]))
                    i += 1
                elif line == "":
                    if not cur["chunks"]:
                        cur["chunks"].append({"anchor": None, "body": []})
                    cur["chunks"][-1]["body"].append(("ctx", ""))
                    i += 1
                else:
                    parse_error(str(i + 1))

    # apply sections
    for sec in sections:
        if sec["type"] == "add":
            if os.path.exists(sec["path"]):
                sys.stderr.write("exists\n")
                sys.exit(1)
            with open(sec["path"], "w") as f:
                f.write("\n".join(sec["lines"]) + "\n")
        elif sec["type"] == "delete":
            if not os.path.exists(sec["path"]):
                sys.stderr.write("missing\n")
                sys.exit(1)
            os.remove(sec["path"])
        elif sec["type"] == "update":
            if not os.path.exists(sec["path"]):
                sys.stderr.write("missing\n")
                sys.exit(1)
            if sec["move"] is not None:
                if os.path.exists(sec["move"]):
                    sys.stderr.write("exists\n")
                    sys.exit(1)
            with open(sec["path"]) as f:
                content = f.read()
            flines = content.split("\n")
            if flines and flines[-1] == "":
                flines = flines[:-1]
            cursor = 0
            for chunk in sec["chunks"]:
                anchor = chunk.get("anchor")
                eof = chunk.get("eof", False)
                if anchor is not None and not eof:
                    # find anchor
                    found = -1
                    for j in range(cursor, len(flines)):
                        if flines[j] == anchor:
                            found = j
                            break
                    if found < 0:
                        sys.stderr.write("no-match\n")
                        sys.exit(1)
                    cursor = found + 1
                # build O and N
                body = chunk.get("body", [])
                O = [t for t, _ in body if t in ("ctx", "del")]
                N = [t for t, _ in body if t in ("ctx", "add")]
                if not O and not N:
                    sys.stderr.write("no-match\n")
                    sys.exit(1)
                # find occurrence of O
                pos = -1
                if not O:
                    pos = cursor
                else:
                    for j in range(cursor, len(flines) - len(O) + 1):
                        if flines[j:j + len(O)] == O:
                            if eof:
                                if j + len(O) == len(flines):
                                    pos = j
                                    break
                            else:
                                pos = j
                                break
                if pos < 0:
                    sys.stderr.write("no-match\n")
                    sys.exit(1)
                new = flines[:pos] + N + flines[pos + len(O):]
                flines = new
                cursor = pos + len(N)
            result = "\n".join(flines)
            if result and not result.endswith("\n"):
                result += "\n"
            target = sec["move"] if sec["move"] else sec["path"]
            with open(target, "w") as f:
                f.write(result)
            if sec["move"]:
                os.remove(sec["path"])


if __name__ == "__main__":
    main()
