# broterm shell integration for zsh: ZDOTDIR points at this directory so zsh
# reads these files, and each one runs the user's own file of the same name
# from their real ZDOTDIR (BROTERM_USER_ZDOTDIR, else $HOME). .zshrc (or
# .zlogin, for a login shell) installs the hooks and hands ZDOTDIR back.

__broterm_zdotdir=$ZDOTDIR
if [[ -n ${BROTERM_USER_ZDOTDIR-} ]]; then
    __broterm_had_zdotdir=1
    ZDOTDIR=$BROTERM_USER_ZDOTDIR
else
    ZDOTDIR=$HOME
fi
unset BROTERM_USER_ZDOTDIR
[[ -r $ZDOTDIR/.zshenv ]] && source $ZDOTDIR/.zshenv
# The user's .zshenv may move ZDOTDIR; where it points now is theirs.
__broterm_user_zdotdir=$ZDOTDIR
if [[ -o interactive ]]; then
    ZDOTDIR=$__broterm_zdotdir
else
    # A non-interactive shell reads no more startup files: hand back now.
    if [[ -n ${__broterm_had_zdotdir-} || $__broterm_user_zdotdir != $HOME ]]; then
        export ZDOTDIR=$__broterm_user_zdotdir
    else
        unset ZDOTDIR
    fi
    unset __broterm_zdotdir __broterm_user_zdotdir __broterm_had_zdotdir
fi
