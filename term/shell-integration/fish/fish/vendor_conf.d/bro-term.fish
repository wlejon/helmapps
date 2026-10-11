# term shell integration for fish. term puts the directory above this
# one's parent first in XDG_DATA_DIRS, so fish loads this file from
# vendor_conf.d along with every other vendor file; the user's config.fish
# and conf.d run as always. It marks the prompt (OSC 133 A and B), the
# command's start (C) with its command line (OSC 633;E) and end with its
# exit code (D), and reports the directory (OSC 7).

status is-interactive; or exit
set -q __bro_term_loaded; and exit
set -g __bro_term_loaded 1
set -e BRO_TERM_SHELL_INTEGRATION

# Take term's directory back out of XDG_DATA_DIRS, so programs started
# from this shell see the user's own value.
if set -q BRO_TERM_FISH_DATA
    set -l dirs
    for d in (string split : -- $XDG_DATA_DIRS)
        test "$d" = "$BRO_TERM_FISH_DATA"; or set -a dirs $d
    end
    if set -q BRO_TERM_XDG_DATA_DIRS_UNSET
        set -e XDG_DATA_DIRS
    else
        set -gx XDG_DATA_DIRS (string join : -- $dirs)
    end
    set -e BRO_TERM_FISH_DATA
    set -e BRO_TERM_XDG_DATA_DIRS_UNSET
end

# OSC 633's escaping: a backslash doubled, ';' and newlines as \xHH. The
# pipe splits a multi-line command into lines, which the join puts back.
function __bro_term_escape
    string replace -a -- '\\' '\\\\' $argv[1] | string replace -a -- ';' '\\x3b' | string join '\\x0a'
end

function __bro_term_preexec --on-event fish_preexec
    set -g __bro_term_ran 1
    printf '\e]633;E;%s\a\e]133;C\a' (__bro_term_escape "$argv")
end

function __bro_term_postexec --on-event fish_postexec
    set -l s $status
    if set -q __bro_term_ran
        printf '\e]133;D;%s\a' $s
        set -e __bro_term_ran
    end
end

function __bro_term_cwd --on-event fish_prompt
    printf '\e]7;file://%s%s\e\\' (prompt_hostname) (string replace -a '%' '%25' -- $PWD)
end

# The prompt marks go around fish_prompt itself. config.fish runs after this
# file and may define its own fish_prompt, so the wrapping waits for the
# first prompt (and is redone if a later one replaces it).
function __bro_term_wrap_prompt --on-event fish_prompt
    if functions -q fish_prompt; and not functions -q __bro_term_user_prompt
        functions -c fish_prompt __bro_term_user_prompt
        function fish_prompt
            printf '\e]133;A\a'
            __bro_term_user_prompt
            printf '\e]133;B\a'
        end
    end
end
