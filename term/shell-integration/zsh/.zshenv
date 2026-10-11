# helmterm shell integration for zsh: ZDOTDIR points at this directory so zsh
# reads these files, and each one runs the user's own file of the same name
# from their real ZDOTDIR (HELMTERM_USER_ZDOTDIR, else $HOME). .zshrc (or
# .zlogin, for a login shell) installs the hooks and hands ZDOTDIR back.

__helmterm_zdotdir=$ZDOTDIR
if [[ -n ${HELMTERM_USER_ZDOTDIR-} ]]; then
    __helmterm_had_zdotdir=1
    ZDOTDIR=$HELMTERM_USER_ZDOTDIR
else
    ZDOTDIR=$HOME
fi
unset HELMTERM_USER_ZDOTDIR
[[ -r $ZDOTDIR/.zshenv ]] && source $ZDOTDIR/.zshenv
# The user's .zshenv may move ZDOTDIR; where it points now is theirs.
__helmterm_user_zdotdir=$ZDOTDIR
if [[ -o interactive ]]; then
    ZDOTDIR=$__helmterm_zdotdir
else
    # A non-interactive shell reads no more startup files: hand back now.
    if [[ -n ${__helmterm_had_zdotdir-} || $__helmterm_user_zdotdir != $HOME ]]; then
        export ZDOTDIR=$__helmterm_user_zdotdir
    else
        unset ZDOTDIR
    fi
    unset __helmterm_zdotdir __helmterm_user_zdotdir __helmterm_had_zdotdir
fi
