# helmterm: the user's .zshrc from their real ZDOTDIR (see .zshenv), then the
# integration, then (unless this is a login shell, whose .zlogin comes next)
# ZDOTDIR handed back.
ZDOTDIR=$__helmterm_user_zdotdir
[[ -r $ZDOTDIR/.zshrc ]] && source $ZDOTDIR/.zshrc
__helmterm_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__helmterm_zdotdir

source $__helmterm_zdotdir/helmterm.zsh

if [[ ! -o login ]]; then
    __helmterm_handback
fi
