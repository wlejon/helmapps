# term shell integration for bash (4.4 and later for command starts).
#
# term starts bash with --init-file pointing here instead of ~/.bashrc, so
# this file first runs what bash would have run: ~/.bashrc for an
# interactive shell, or /etc/profile and the first of ~/.bash_profile,
# ~/.bash_login and ~/.profile when the profile asked for a login shell
# (BRO_TERM_BASH_LOGIN). Then it marks the prompt (OSC 133 A and B), the
# command's start (C, from PS0) and end with its exit code (D), and reports
# the directory (OSC 7). The command line is left to the terminal, which
# reads what was typed between B and C. Nothing here is written to disk.

if [ -n "${BRO_TERM_BASH_LOGIN-}" ]; then
    unset BRO_TERM_BASH_LOGIN
    [ -r /etc/profile ] && . /etc/profile
    for __bro_term_f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
        if [ -r "$__bro_term_f" ]; then . "$__bro_term_f"; break; fi
    done
    unset __bro_term_f
else
    [ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
fi

if [ -z "${__bro_term_loaded-}" ] && [ -n "${BASH_VERSION-}" ]; then
__bro_term_loaded=1
unset BRO_TERM_SHELL_INTEGRATION

__bro_term_ran=0
__bro_term_pwd_for=
__bro_term_pwd=

# The directory as the terminal can use it. On Windows (Git Bash, MSYS2,
# Cygwin) $PWD is a POSIX view ("/c/Users/x", "/tmp"); `pwd -W` gives the
# Windows path. That costs a subshell, so only when the directory changed.
__bro_term_cwd() {
    if [ "$PWD" = "$__bro_term_pwd_for" ]; then return; fi
    __bro_term_pwd_for=$PWD
    case "${OSTYPE-}" in
        msys*|cygwin*)
            __bro_term_pwd=$(builtin pwd -W 2>/dev/null || cygpath -m "$PWD" 2>/dev/null || printf %s "$PWD")
            case "$__bro_term_pwd" in [A-Za-z]:*) __bro_term_pwd=/$__bro_term_pwd ;; esac ;;
        *) __bro_term_pwd=$PWD ;;
    esac
    __bro_term_pwd=${__bro_term_pwd//%/%25}
}

# First in PROMPT_COMMAND: the exit status, before anything else changes it.
__bro_term_precmd() {
    local __bro_term_status=$?
    __bro_term_in_prompt=1
    if [ "$__bro_term_ran" = 1 ]; then
        printf '\033]133;D;%s\007' "$__bro_term_status"
    fi
    __bro_term_ran=0
    __bro_term_cwd
    printf '\033]7;file://%s%s\033\\' "${HOSTNAME-}" "$__bro_term_pwd"
    return $__bro_term_status
}

# Last in PROMPT_COMMAND: wrap PS1 in the prompt marks, again if something
# (a prompt framework) rebuilt it since.
__bro_term_ps1() {
    local __bro_term_status=$?
    case "$PS1" in
        *'133;A'*) ;;
        *) PS1='\[\033]133;A\007\]'"$PS1"'\[\033]133;B\007\]' ;;
    esac
    __bro_term_in_prompt=0
    return $__bro_term_status
}

# bash 5.1 lets PROMPT_COMMAND be an array.
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    PROMPT_COMMAND=(__bro_term_precmd "${PROMPT_COMMAND[@]}" __bro_term_ps1)
else
    PROMPT_COMMAND="__bro_term_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}; __bro_term_ps1"
fi

# PS0 is printed after a command is read and before it runs (bash 4.4+).
# On older bash (e.g. bash 3.2 on macOS), fall back to a DEBUG trap.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ] || ([ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -lt 4 ]); then
    __bro_term_preexec() {
        if [ "${__bro_term_in_prompt:-0}" = 1 ]; then return; fi
        if [ "$__bro_term_ran" = 0 ]; then
            __bro_term_ran=1
            printf '\033]133;C\007'
        fi
    }
    trap '__bro_term_preexec' DEBUG
else
    PS0='${__bro_term_noop[__bro_term_ran=1]}\033]133;C\007'"${PS0-}"
fi
fi
