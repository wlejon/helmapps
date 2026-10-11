# helmterm shell integration for bash (4.4 and later for command starts).
#
# helmterm starts bash with --init-file pointing here instead of ~/.bashrc, so
# this file first runs what bash would have run: ~/.bashrc for an
# interactive shell, or /etc/profile and the first of ~/.bash_profile,
# ~/.bash_login and ~/.profile when the profile asked for a login shell
# (HELMTERM_BASH_LOGIN). Then it marks the prompt (OSC 133 A and B), the
# command's start (C, from PS0) and end with its exit code (D), and reports
# the directory (OSC 7). The command line is left to the terminal, which
# reads what was typed between B and C. Nothing here is written to disk.

if [ -n "${HELMTERM_BASH_LOGIN-}" ]; then
    unset HELMTERM_BASH_LOGIN
    [ -r /etc/profile ] && . /etc/profile
    for __helmterm_f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
        if [ -r "$__helmterm_f" ]; then . "$__helmterm_f"; break; fi
    done
    unset __helmterm_f
else
    [ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
fi

if [ -z "${__helmterm_loaded-}" ] && [ -n "${BASH_VERSION-}" ]; then
__helmterm_loaded=1
unset HELMTERM_SHELL_INTEGRATION

__helmterm_ran=0
__helmterm_pwd_for=
__helmterm_pwd=

# The directory as the terminal can use it. On Windows (Git Bash, MSYS2,
# Cygwin) $PWD is a POSIX view ("/c/Users/x", "/tmp"); `pwd -W` gives the
# Windows path. That costs a subshell, so only when the directory changed.
__helmterm_cwd() {
    if [ "$PWD" = "$__helmterm_pwd_for" ]; then return; fi
    __helmterm_pwd_for=$PWD
    case "${OSTYPE-}" in
        msys*|cygwin*)
            __helmterm_pwd=$(builtin pwd -W 2>/dev/null || cygpath -m "$PWD" 2>/dev/null || printf %s "$PWD")
            case "$__helmterm_pwd" in [A-Za-z]:*) __helmterm_pwd=/$__helmterm_pwd ;; esac ;;
        *) __helmterm_pwd=$PWD ;;
    esac
    __helmterm_pwd=${__helmterm_pwd//%/%25}
}

# First in PROMPT_COMMAND: the exit status, before anything else changes it.
__helmterm_precmd() {
    local __helmterm_status=$?
    __helmterm_in_prompt=1
    if [ "$__helmterm_ran" = 1 ]; then
        printf '\033]133;D;%s\007' "$__helmterm_status"
    fi
    __helmterm_ran=0
    __helmterm_cwd
    printf '\033]7;file://%s%s\033\\' "${HOSTNAME-}" "$__helmterm_pwd"
    return $__helmterm_status
}

# Last in PROMPT_COMMAND: wrap PS1 in the prompt marks, again if something
# (a prompt framework) rebuilt it since.
__helmterm_ps1() {
    local __helmterm_status=$?
    case "$PS1" in
        *'133;A'*) ;;
        *) PS1='\[\033]133;A\007\]'"$PS1"'\[\033]133;B\007\]' ;;
    esac
    __helmterm_in_prompt=0
    return $__helmterm_status
}

# bash 5.1 lets PROMPT_COMMAND be an array.
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    PROMPT_COMMAND=(__helmterm_precmd "${PROMPT_COMMAND[@]}" __helmterm_ps1)
else
    PROMPT_COMMAND="__helmterm_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}; __helmterm_ps1"
fi

# PS0 is printed after a command is read and before it runs (bash 4.4+).
# On older bash (e.g. bash 3.2 on macOS), fall back to a DEBUG trap.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ] || ([ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -lt 4 ]); then
    __helmterm_preexec() {
        if [ "${__helmterm_in_prompt:-0}" = 1 ]; then return; fi
        if [ "$__helmterm_ran" = 0 ]; then
            __helmterm_ran=1
            printf '\033]133;C\007'
        fi
    }
    trap '__helmterm_preexec' DEBUG
else
    PS0='${__helmterm_noop[__helmterm_ran=1]}\033]133;C\007'"${PS0-}"
fi
fi
