# broterm shell integration for bash (4.4 and later for command starts).
#
# broterm starts bash with --init-file pointing here instead of ~/.bashrc, so
# this file first runs what bash would have run: ~/.bashrc for an
# interactive shell, or /etc/profile and the first of ~/.bash_profile,
# ~/.bash_login and ~/.profile when the profile asked for a login shell
# (BROTERM_BASH_LOGIN). Then it marks the prompt (OSC 133 A and B), the
# command's start (C, from PS0) and end with its exit code (D), and reports
# the directory (OSC 7). The command line is left to the terminal, which
# reads what was typed between B and C. Nothing here is written to disk.

if [ -n "${BROTERM_BASH_LOGIN-}" ]; then
    unset BROTERM_BASH_LOGIN
    [ -r /etc/profile ] && . /etc/profile
    for __broterm_f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
        if [ -r "$__broterm_f" ]; then . "$__broterm_f"; break; fi
    done
    unset __broterm_f
else
    [ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
fi

if [ -z "${__broterm_loaded-}" ] && [ -n "${BASH_VERSION-}" ]; then
__broterm_loaded=1
unset BROTERM_SHELL_INTEGRATION

__broterm_ran=0
__broterm_pwd_for=
__broterm_pwd=

# The directory as the terminal can use it. On Windows (Git Bash, MSYS2,
# Cygwin) $PWD is a POSIX view ("/c/Users/x", "/tmp"); `pwd -W` gives the
# Windows path. That costs a subshell, so only when the directory changed.
__broterm_cwd() {
    if [ "$PWD" = "$__broterm_pwd_for" ]; then return; fi
    __broterm_pwd_for=$PWD
    case "${OSTYPE-}" in
        msys*|cygwin*)
            __broterm_pwd=$(builtin pwd -W 2>/dev/null || cygpath -m "$PWD" 2>/dev/null || printf %s "$PWD")
            case "$__broterm_pwd" in [A-Za-z]:*) __broterm_pwd=/$__broterm_pwd ;; esac ;;
        *) __broterm_pwd=$PWD ;;
    esac
    __broterm_pwd=${__broterm_pwd//%/%25}
}

# First in PROMPT_COMMAND: the exit status, before anything else changes it.
__broterm_precmd() {
    local __broterm_status=$?
    if [ "$__broterm_ran" = 1 ]; then
        printf '\033]133;D;%s\007' "$__broterm_status"
    fi
    __broterm_ran=0
    __broterm_cwd
    printf '\033]7;file://%s%s\033\\' "${HOSTNAME-}" "$__broterm_pwd"
    return $__broterm_status
}

# Last in PROMPT_COMMAND: wrap PS1 in the prompt marks, again if something
# (a prompt framework) rebuilt it since.
__broterm_ps1() {
    local __broterm_status=$?
    case "$PS1" in
        *'133;A'*) ;;
        *) PS1='\[\033]133;A\007\]'"$PS1"'\[\033]133;B\007\]' ;;
    esac
    return $__broterm_status
}

# bash 5.1 lets PROMPT_COMMAND be an array.
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    PROMPT_COMMAND=(__broterm_precmd "${PROMPT_COMMAND[@]}" __broterm_ps1)
else
    PROMPT_COMMAND="__broterm_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}; __broterm_ps1"
fi

# PS0 is printed after a command is read and before it runs (bash 4.4+). The
# array subscript is arithmetic, evaluated in this shell: it records that a
# command ran, without a subshell and without printing anything.
PS0='${__broterm_noop[__broterm_ran=1]}\033]133;C\007'"${PS0-}"
fi
